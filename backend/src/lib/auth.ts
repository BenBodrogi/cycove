import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from './redis.js';

const SESSION_KEY_PREFIX = 'session:';
const DEVICE_SESSIONS_PREFIX = 'device-sessions:';

// Opaque bearer session token, issued at registration/device-link time.
// No expiry/refresh mechanism yet — this is a placeholder scheme to unblock
// the authenticated routes; see docs/api/openapi.yaml (bearerAuth) and
// Projects/CyCove.md Open questions for the real design still to do.
//
// Also tracked in a reverse index (device-sessions:<deviceId> -> set of
// tokens) so a device's sessions can all be revoked at once — see
// revokeDeviceSessions below. Without this, "revoke this device" would need
// a full scan over every live session key, which doesn't scale and isn't
// how Redis is meant to be used.
export async function issueSessionToken(deviceId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await redis.set(`${SESSION_KEY_PREFIX}${token}`, deviceId);
  await redis.sadd(`${DEVICE_SESSIONS_PREFIX}${deviceId}`, token);
  return token;
}

// Shared by requireAuth (HTTP) and the WS connect handler's first-message
// auth (see routes/connect.ts) — same token, two different transports.
export async function resolveSessionToken(token: string): Promise<string | null> {
  return redis.get(`${SESSION_KEY_PREFIX}${token}`);
}

// Invalidates every live session token for a device — used by DELETE
// /devices/:deviceId (backend/src/routes/devices.ts) so a revoked device
// stops working immediately, not just after Prisma removes its row.
export async function revokeDeviceSessions(deviceId: string): Promise<void> {
  const tokens = await redis.smembers(`${DEVICE_SESSIONS_PREFIX}${deviceId}`);
  if (tokens.length > 0) {
    await redis.del(...tokens.map((t) => `${SESSION_KEY_PREFIX}${t}`));
  }
  await redis.del(`${DEVICE_SESSIONS_PREFIX}${deviceId}`);
}

declare module 'fastify' {
  interface FastifyRequest {
    deviceId?: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    return reply.code(401).send({ error: 'Missing bearer token' });
  }

  const deviceId = await resolveSessionToken(token);
  if (!deviceId) {
    return reply.code(401).send({ error: 'Invalid or expired session token' });
  }

  request.deviceId = deviceId;
}
