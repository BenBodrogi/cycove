import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '../lib/auth.js';
import { relayToDevice } from '../lib/relay.js';

interface SendMessageBody {
  recipient_device_id?: string;
  event_type?: string;
  content?: Prisma.InputJsonValue;
}

// POST /messages — HTTP fallback send path for when the recipient isn't
// connected via WS /connect. See docs/api/openapi.yaml and lib/relay.ts
// (shared with the WS sendToDevice handler — same operation, different
// transport). Generic to-device event, not just chat messages — see
// docs/crypto-integration-notes.md.
export async function messageRoutes(app: FastifyInstance) {
  app.post<{ Body: SendMessageBody }>(
    '/messages',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { recipient_device_id, event_type, content } = request.body ?? {};
      if (!recipient_device_id || !event_type || content === undefined) {
        return reply.code(400).send({ error: 'recipient_device_id, event_type, and content are required' });
      }

      await relayToDevice(request.deviceId!, recipient_device_id, event_type, content);
      return reply.code(202).send();
    },
  );
}
