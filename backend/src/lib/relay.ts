import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { getConnection } from './connections.js';

// Shared by the WS relay's sendToDevice handler and POST /messages (the
// HTTP fallback path) — same operation, two transports, see
// Projects/CyCove.md -> Architecture -> Backend.
//
// Generic to-device event relay, not just chat messages — carries both
// encrypted messages (event_type "m.room.encrypted") and plain
// verification-protocol messages (event_type "m.key.verification.*") the
// same way, since the server treats content opaquely either way. See
// docs/crypto-integration-notes.md for why this isn't split into two paths.
//
// Always persisted first (durability), then best-effort pushed live if the
// recipient happens to be connected right now. A live push isn't a
// substitute for the queue row — it's an optimization on top of it; the row
// only goes away on an explicit deliveryAck (THREAT_MODEL.md -> Server
// compromise: no server-side history retention beyond that).
export async function relayToDevice(
  senderDeviceId: string,
  recipientDeviceId: string,
  eventType: string,
  content: Prisma.InputJsonValue,
) {
  const queued = await prisma.toDeviceQueue.create({
    data: {
      senderDeviceId,
      recipientDeviceId,
      eventType,
      content,
    },
    include: { senderDevice: { select: { userId: true } } },
  });

  const recipientSocket = getConnection(recipientDeviceId);
  if (recipientSocket) {
    recipientSocket.send(
      JSON.stringify({
        type: 'toDeviceEvent',
        message_id: queued.id,
        sender_device_id: senderDeviceId,
        // The recipient's OlmMachine.receiveSyncChanges needs the sender's
        // *user* ID, not just their device ID — to-device events are shaped
        // {sender, type, content} — see docs/crypto-integration-notes.md.
        sender_user_id: queued.senderDevice.userId,
        event_type: eventType,
        content,
      }),
    );
  }
  // TODO: FCM push wake-up if recipient isn't connected — not implemented yet,
  // needs FCM_SERVICE_ACCOUNT_JSON (see backend/.env.example).

  return queued;
}
