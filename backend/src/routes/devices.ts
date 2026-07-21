import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { requireAuth, issueSessionToken, revokeDeviceSessions } from '../lib/auth.js';

const PAIRING_KEY_PREFIX = 'pairing:';
const PAIRING_TTL_SECONDS = 5 * 60; // short-lived, single-use — see docs/ux-flows.md

interface LinkDeviceBody {
  pairing_token?: string;
  device_id?: string;
  device_keys?: Prisma.InputJsonValue;
  one_time_keys?: Record<string, Prisma.InputJsonValue>;
  push_token?: string | null;
}

// POST /devices/pairing-token, POST /devices/link — see
// Projects/CyCove.md -> Architecture -> Client (Multi-Device Linking Flow)
// and docs/ux-flows.md -> Contact-adding flow's QR pattern (same idea, for
// devices instead of contacts).
//
// /devices/pairing-token isn't in the original docs/api/openapi.yaml — that
// spec only covered the linking side. Adding it here because /devices/link
// can't work without a way to issue the token it consumes.
export async function deviceRoutes(app: FastifyInstance) {
  app.post('/devices/pairing-token', { preHandler: requireAuth }, async (request, reply) => {
    const device = await prisma.device.findUniqueOrThrow({ where: { id: request.deviceId! } });

    const token = randomBytes(16).toString('hex');
    await redis.set(`${PAIRING_KEY_PREFIX}${token}`, device.userId, 'EX', PAIRING_TTL_SECONDS);

    return reply.send({ pairing_token: token, expires_in: PAIRING_TTL_SECONDS });
  });

  app.post<{ Body: LinkDeviceBody }>('/devices/link', async (request, reply) => {
    const { pairing_token, device_id, device_keys, one_time_keys, push_token } = request.body ?? {};

    if (!pairing_token || !device_id || !device_keys) {
      return reply.code(400).send({
        error: 'pairing_token, device_id, and device_keys are required',
      });
    }

    const userId = await redis.get(`${PAIRING_KEY_PREFIX}${pairing_token}`);
    if (!userId) {
      return reply.code(404).send({ error: 'Pairing token not found or expired' });
    }
    await redis.del(`${PAIRING_KEY_PREFIX}${pairing_token}`); // single-use

    const otkEntries = Object.entries(one_time_keys ?? {});

    let newDevice;
    try {
      newDevice = await prisma.device.create({
        data: {
          id: device_id,
          userId,
          deviceKeys: device_keys,
          pushToken: push_token ?? null,
          oneTimeKeys: {
            create: otkEntries.map(([keyId, keyData]) => ({ keyId, keyData })),
          },
        },
        include: { _count: { select: { oneTimeKeys: true } } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'device_id already taken' });
      }
      throw err;
    }

    const sessionToken = await issueSessionToken(newDevice.id);

    return reply.code(201).send({
      device_id: newDevice.id,
      session_token: sessionToken,
      one_time_key_counts: { signed_curve25519: newDevice._count.oneTimeKeys },
    });
  });

  // GET /devices, DELETE /devices/:deviceId — the "Your devices" list + revoke
  // pair, added alongside QR-code linking: a QR code can be captured by a
  // camera from across a room in an instant, unlike a copy-pasted string, so
  // an easy way to see and undo an unwanted link matters more once QR exists.
  // See THREAT_MODEL.md -> MITM at first contact and docs/ux-flows.md.
  app.get('/devices', { preHandler: requireAuth }, async (request, reply) => {
    // findUnique + explicit null check, not findUniqueOrThrow: this route
    // exists specifically so a device can be revoked (deleted), and once
    // that's possible, a caller's own token can legitimately point at a
    // device row that's already gone — e.g. the tab that revoked itself, or
    // another live tab whose token wasn't cleaned up yet. That's a normal
    // "please log in again" case, not a server bug; findUniqueOrThrow would
    // turn it into an unhandled 500 instead of a clean 401.
    const caller = await prisma.device.findUnique({ where: { id: request.deviceId! } });
    if (!caller) {
      return reply.code(401).send({ error: 'Invalid or expired session token' });
    }
    const devices = await prisma.device.findMany({
      where: { userId: caller.userId },
      select: { id: true, createdAt: true, lastSeenAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send({ devices });
  });

  app.delete<{ Params: { deviceId: string } }>(
    '/devices/:deviceId',
    { preHandler: requireAuth },
    async (request, reply) => {
      // Same reasoning as GET /devices above — a caller's own device row can
      // legitimately be gone already (e.g. revoking it twice from two tabs).
      const caller = await prisma.device.findUnique({ where: { id: request.deviceId! } });
      if (!caller) {
        return reply.code(401).send({ error: 'Invalid or expired session token' });
      }
      const target = await prisma.device.findUnique({ where: { id: request.params.deviceId } });

      // The critical check: without this, any authenticated user could
      // revoke any device on any account just by guessing/enumerating IDs.
      if (!target || target.userId !== caller.userId) {
        return reply.code(404).send({ error: 'Device not found' });
      }

      await revokeDeviceSessions(target.id);
      await prisma.device.delete({ where: { id: target.id } });

      return reply.code(204).send();
    },
  );
}
