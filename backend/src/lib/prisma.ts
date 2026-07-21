import { PrismaClient } from '@prisma/client';

// Single shared client — Prisma manages its own connection pool internally,
// creating one per request would exhaust Postgres connections.
export const prisma = new PrismaClient();
