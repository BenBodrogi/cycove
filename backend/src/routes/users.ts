import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';

// POST-launch reversal of the original "local label only, no directory"
// identity model — see docs/crypto-integration-notes.md and
// Projects/CyCove.md -> Key decisions -> Identity model for why. Usernames
// are optional, unique, lowercase-only ASCII (caps, doesn't eliminate,
// homoglyph-spoofing risk now that this is a real discovery mechanism).

const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

interface ClaimUsernameBody {
  username?: string;
}

export async function userRoutes(app: FastifyInstance) {
  app.put<{ Body: ClaimUsernameBody }>('/users/username', { preHandler: requireAuth }, async (request, reply) => {
    const allowed = await checkRateLimit(`claim-username:${request.deviceId}`, 10, 60 * 60);
    if (!allowed) {
      return reply.code(429).send({ error: 'Too many username changes — try again later' });
    }

    const username = request.body?.username?.toLowerCase();
    if (!username || !USERNAME_PATTERN.test(username)) {
      return reply.code(400).send({ error: 'username must be 3-32 characters, lowercase letters/numbers/underscore only' });
    }

    const device = await prisma.device.findUniqueOrThrow({ where: { id: request.deviceId! } });

    try {
      await prisma.user.update({ where: { id: device.userId }, data: { username } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'username already taken' });
      }
      throw err;
    }

    return reply.send({ username });
  });

  app.get<{ Params: { username: string } }>(
    '/users/by-username/:username',
    { preHandler: requireAuth },
    async (request, reply) => {
      const allowed = await checkRateLimit(`lookup-username:${request.deviceId}`, 30, 60);
      if (!allowed) {
        return reply.code(429).send({ error: 'Too many lookups — try again later' });
      }

      const username = request.params.username.toLowerCase();
      const user = await prisma.user.findUnique({
        where: { username },
        include: { devices: { orderBy: { lastSeenAt: 'desc' }, take: 1 } },
      });

      // Picks the most-recently-active device — a deliberate simplification,
      // not a new gap: no real multi-device usage exists anywhere in the app
      // yet. Revisit once device linking is actually wired up client-side.
      const device = user?.devices[0];
      if (!user || !device) {
        return reply.code(404).send({ error: 'No user with that username' });
      }

      return reply.send({ user_id: user.id, device_id: device.id });
    },
  );
}
