import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { issueSessionToken } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';

interface RegisterBody {
  user_id?: string;
  device_id?: string;
  recovery_key_hash?: string;
  device_keys?: Prisma.InputJsonValue;
  one_time_keys?: Record<string, Prisma.InputJsonValue>;
  fallback_keys?: Prisma.InputJsonValue;
  push_token?: string | null;
}

// POST /register — see docs/api/openapi.yaml and docs/crypto-integration-notes.md.
// Creates an account identified by a random public ID, plus its first
// device. No phone/email collected — see Projects/CyCove.md -> Key
// decisions -> Identity model.
//
// user_id and device_id are CLIENT-generated, not server-assigned: the
// client's OlmMachine needs both before it can generate any keys at all
// (OlmMachine.initialize(userId, deviceId) comes first), and the resulting
// device_keys blob is self-signed with those exact IDs baked in — a
// server-assigned ID after the fact would mismatch the signed content. See
// docs/crypto-integration-notes.md.
//
// device_keys/one_time_keys/fallback_keys are opaque Matrix-shaped blobs
// straight from the client's OlmMachine's first KeysUploadRequest — the
// server stores and serves them without parsing. The response's
// one_time_key_counts is required by matrix-sdk-crypto-wasm's
// markRequestAsSent (throws without it) — see docs/crypto-integration-notes.md.
export async function registerRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>('/register', async (request, reply) => {
    // Registration is otherwise free (no phone/email to gate on) — rate-limit
    // by IP to blunt mass account creation. See Projects/CyCove.md ->
    // Architecture -> Backend, an open backlog item until now.
    const allowed = await checkRateLimit(`register:${request.ip}`, 5, 60 * 60);
    if (!allowed) {
      return reply.code(429).send({ error: 'Too many registration attempts — try again later' });
    }

    const { user_id, device_id, recovery_key_hash, device_keys, one_time_keys, push_token } =
      request.body ?? {};

    if (!user_id || !device_id || !recovery_key_hash || !device_keys) {
      return reply.code(400).send({
        error: 'user_id, device_id, recovery_key_hash, and device_keys are required',
      });
    }

    const otkEntries = Object.entries(one_time_keys ?? {});

    let user;
    try {
      user = await prisma.user.create({
        data: {
          id: user_id,
          recoveryKeyHash: recovery_key_hash,
          devices: {
            create: {
              id: device_id,
              deviceKeys: device_keys,
              pushToken: push_token ?? null,
              oneTimeKeys: {
                create: otkEntries.map(([keyId, keyData]) => ({ keyId, keyData })),
              },
            },
          },
        },
        include: { devices: { include: { _count: { select: { oneTimeKeys: true } } } } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'user_id or device_id already taken' });
      }
      throw err;
    }

    const device = user.devices[0]!;
    const sessionToken = await issueSessionToken(device.id);

    return reply.code(201).send({
      user_id: user.id,
      device_id: device.id,
      session_token: sessionToken,
      one_time_key_counts: { signed_curve25519: device._count.oneTimeKeys },
    });
  });
}
