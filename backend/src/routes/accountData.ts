import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';

// Opaque encrypted backup blobs — the client encrypts client-side (see
// web/src/lib/crypto.ts, key derived from the recovery key) and the server
// only ever stores/serves ciphertext it can't read, same "dumb pipe" pattern
// as device_keys/one_time_keys/to_device_queue. "contacts" and
// "cross-signing" both live in the same table, keyed by [userId, dataType]
// — see docs/crypto-integration-notes.md for why this isn't built on
// matrix-sdk-crypto-wasm's Megolm room-key backup feature.

const VALID_DATA_TYPES = new Set(['contacts', 'cross-signing']);

interface PutBackupBody {
  ciphertext?: string; // base64
  iv?: string; // base64
}

export async function accountDataRoutes(app: FastifyInstance) {
  app.put<{ Params: { dataType: string }; Body: PutBackupBody }>(
    '/account-data/:dataType',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { dataType } = request.params;
      if (!VALID_DATA_TYPES.has(dataType)) {
        return reply.code(400).send({ error: 'Unknown dataType' });
      }
      const { ciphertext, iv } = request.body ?? {};
      if (!ciphertext || !iv) {
        return reply.code(400).send({ error: 'ciphertext and iv are required' });
      }

      const device = await prisma.device.findUniqueOrThrow({ where: { id: request.deviceId! } });

      await prisma.encryptedBackup.upsert({
        where: { userId_dataType: { userId: device.userId, dataType } },
        create: {
          userId: device.userId,
          dataType,
          ciphertext: Buffer.from(ciphertext, 'base64'),
          iv: Buffer.from(iv, 'base64'),
        },
        update: {
          ciphertext: Buffer.from(ciphertext, 'base64'),
          iv: Buffer.from(iv, 'base64'),
        },
      });

      return reply.code(204).send();
    },
  );

  app.get<{ Params: { dataType: string } }>('/account-data/:dataType', { preHandler: requireAuth }, async (request, reply) => {
    const { dataType } = request.params;
    if (!VALID_DATA_TYPES.has(dataType)) {
      return reply.code(400).send({ error: 'Unknown dataType' });
    }
    const device = await prisma.device.findUniqueOrThrow({ where: { id: request.deviceId! } });

    const backup = await prisma.encryptedBackup.findUnique({ where: { userId_dataType: { userId: device.userId, dataType } } });
    if (!backup) {
      return reply.code(404).send({ error: 'No backup found' });
    }

    return reply.send({
      ciphertext: Buffer.from(backup.ciphertext).toString('base64'),
      iv: Buffer.from(backup.iv).toString('base64'),
    });
  });
}
