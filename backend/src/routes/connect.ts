import type { FastifyInstance } from 'fastify';
import type { RawData } from 'ws';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { resolveSessionToken } from '../lib/auth.js';
import { registerConnection, unregisterConnection } from '../lib/connections.js';
import { relayToDevice } from '../lib/relay.js';

// WS relay — see docs/api/asyncapi.yaml "connect" channel.
//
// Auth happens via the *first message*, not a header or query param: native
// browser WebSocket can't set custom headers, and a token in the connection
// URL/query string is more likely to leak into logs or browser history than
// one sent as the first frame over an already-established connection.
//
// Generic to-device event relay (sendToDevice/toDeviceEvent), not just chat
// messages — carries both encrypted messages and plain verification-protocol
// messages the same way. See docs/crypto-integration-notes.md.

interface IncomingMessage {
  type?: string;
  token?: string;
  recipient_device_id?: string;
  event_type?: string;
  content?: Prisma.InputJsonValue;
  message_id?: string;
}

function sendError(socket: { send: (data: string) => void }, error: string) {
  socket.send(JSON.stringify({ type: 'error', error }));
}

export async function connectRoutes(app: FastifyInstance) {
  app.get('/v1/connect', { websocket: true }, (socket) => {
    let deviceId: string | undefined;
    // `ws` fires 'message' for each frame without awaiting the previous
    // listener call, so two sendToDevice calls sent back to back (e.g. a SAS
    // mac immediately followed by its done) can race in relayToDevice's async
    // DB write and reach the recipient out of order. Chain each message onto
    // a per-connection queue so they're handled in the order they arrived.
    let queue = Promise.resolve();

    socket.on('message', (raw) => {
      queue = queue.then(() => handleMessage(raw));
    });

    async function handleMessage(raw: RawData) {
      let message: IncomingMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        sendError(socket, 'Malformed JSON');
        return;
      }

      // First message must authenticate. Nothing else is processed until then.
      if (!deviceId) {
        if (message.type !== 'auth' || !message.token) {
          sendError(socket, 'First message must be {"type":"auth","token":"..."}');
          socket.close(4001, 'Unauthenticated');
          return;
        }

        const resolvedDeviceId = await resolveSessionToken(message.token);
        if (!resolvedDeviceId) {
          sendError(socket, 'Invalid or expired session token');
          socket.close(4001, 'Unauthenticated');
          return;
        }

        deviceId = resolvedDeviceId;
        registerConnection(deviceId, socket);

        // Flush anything queued while this device was offline — see
        // Projects/CyCove.md -> Architecture -> Backend.
        const queued = await prisma.toDeviceQueue.findMany({
          where: { recipientDeviceId: deviceId },
          orderBy: { createdAt: 'asc' },
          include: { senderDevice: { select: { userId: true } } },
        });

        socket.send(
          JSON.stringify({
            type: 'queueFlush',
            messages: queued.map((m) => ({
              message_id: m.id,
              sender_device_id: m.senderDeviceId,
              // See lib/relay.ts — the recipient's OlmMachine needs the
              // sender's user ID, not just their device ID.
              sender_user_id: m.senderDevice.userId,
              event_type: m.eventType,
              content: m.content,
            })),
          }),
        );
        return;
      }

      // Reached only once authenticated — deviceId is guaranteed set here
      // because the block above returns on every path where it isn't.
      const authedDeviceId = deviceId;

      if (message.type === 'sendToDevice') {
        if (!message.recipient_device_id || !message.event_type || message.content === undefined) {
          sendError(socket, 'recipient_device_id, event_type, and content are required');
          return;
        }
        await relayToDevice(authedDeviceId, message.recipient_device_id, message.event_type, message.content);
        return;
      }

      if (message.type === 'deliveryAck') {
        if (!message.message_id) {
          sendError(socket, 'message_id is required');
          return;
        }
        // recipientDeviceId check: a device can only ack messages addressed
        // to itself, not arbitrary IDs it might guess. Deleted immediately
        // on ack — see THREAT_MODEL.md -> Server compromise.
        await prisma.toDeviceQueue.deleteMany({
          where: { id: message.message_id, recipientDeviceId: authedDeviceId },
        });
        return;
      }

      sendError(socket, `Unknown message type: ${message.type}`);
    }

    socket.on('close', () => {
      if (deviceId) {
        unregisterConnection(deviceId, socket);
      }
    });
  });
}
