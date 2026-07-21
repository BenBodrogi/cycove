import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { relayToDevice } from '../lib/relay.js';
import { checkRateLimit } from '../lib/rateLimit.js';

// POST /contacts/request — sends a contact request notification.
//
// Deliberately a plain authenticated HTTP action, not a WS sendToDevice
// message: the actual abuse vector this needs to be rate-limited against
// is *sending unsolicited requests*, but WS to-device content is Olm-
// encrypted by the time it reaches the server (the whole point of E2EE),
// so the server can't distinguish a contact-request event from an ordinary
// message at that layer to target it with a precise limit. Routing it
// through its own HTTP endpoint gets a normal per-route rate limit, same
// as the username endpoints, at the cost of the request payload (just a
// username, already resolvable server-side via /users/by-username anyway)
// being visible in transit — see THREAT_MODEL.md. Still relayed via the
// same relayToDevice() used by the WS path and POST /messages, so delivery
// (live push or queued) behaves identically either way.
interface ContactRequestBody {
  recipient_user_id?: string;
  recipient_device_id?: string;
  username?: string | null;
}

export async function contactRoutes(app: FastifyInstance) {
  app.post<{ Body: ContactRequestBody }>(
    '/contacts/request',
    { preHandler: requireAuth },
    async (request, reply) => {
      const allowed = await checkRateLimit(`contact-request:${request.deviceId}`, 20, 60 * 60);
      if (!allowed) {
        return reply.code(429).send({ error: 'Too many contact requests — try again later' });
      }

      const { recipient_device_id, username } = request.body ?? {};
      if (!recipient_device_id) {
        return reply.code(400).send({ error: 'recipient_device_id is required' });
      }

      await relayToDevice(request.deviceId!, recipient_device_id, 'm.cycove.contact_request', { username: username ?? null });
      return reply.code(202).send();
    },
  );
}
