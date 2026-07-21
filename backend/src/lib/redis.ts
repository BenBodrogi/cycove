import { Redis } from 'ioredis';

// Named import, not default — under NodeNext module resolution, ioredis's
// default export isn't constructable through the synthetic-default interop.
export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
