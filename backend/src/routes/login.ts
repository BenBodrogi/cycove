import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { issueSessionToken } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';

interface LoginBody {
  username?: string;
  recovery_key_hash?: string;
}

// POST /login — re-authenticates an existing account on the same device that
// created it. See docs/ux-flows.md and Projects/CyCove.md -> Key decisions
// -> Identity model for why this only restores access on a device that
// already has the account's local key material (matrix-sdk-crypto-wasm's
// IndexedDB store) — a session token alone doesn't let a new browser act as
// an existing crypto identity, the client is responsible for detecting that
// mismatch (see web/src/lib/crypto.ts's CyCoveCrypto.login()).
//
// recovery_key_hash arrives pre-hashed from the client, same convention as
// /register's recovery_key_hash — the server never sees the raw recovery key.
export async function loginRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    // Recovery-key entropy (~244 bits, two crypto.randomUUID()s — see
    // ClientApp.tsx's handleRegister) already makes brute force practically
    // infeasible regardless of rate limit; this is abuse-prevention, not the
    // primary protection.
    const allowed = await checkRateLimit(`login:${request.ip}`, 10, 60 * 60);
    if (!allowed) {
      return reply.code(429).send({ error: 'Too many login attempts — try again later' });
    }

    const username = request.body?.username?.toLowerCase();
    const recoveryKeyHash = request.body?.recovery_key_hash;
    if (!username || !recoveryKeyHash) {
      return reply.code(400).send({ error: 'username and recovery_key_hash are required' });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: { devices: { orderBy: { lastSeenAt: 'desc' }, take: 1 } },
    });

    // Same error for "no such user" and "wrong recovery key" — don't leak
    // which part was wrong.
    const device = user?.devices[0];
    if (!user || !device || user.recoveryKeyHash !== recoveryKeyHash) {
      return reply.code(401).send({ error: 'Invalid username or recovery key' });
    }

    const sessionToken = await issueSessionToken(device.id);

    return reply.send({ user_id: user.id, device_id: device.id, session_token: sessionToken });
  });
}
