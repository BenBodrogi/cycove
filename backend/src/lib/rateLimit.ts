import { redis } from './redis.js';

// Simple fixed-window counter — good enough for this scale. Hand-rolled
// rather than a Fastify plugin dependency to match the project's existing
// pattern of small custom utilities over libraries (see auth.ts's bearer
// token scheme). Not applied via preHandler everywhere: contact-request
// throttling happens over the WS relay, not an HTTP route, so callers use
// this directly — see routes/connect.ts.
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }
  return count <= limit;
}
