import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import cors from '@fastify/cors';
import { registerRoutes } from './routes/register.js';
import { loginRoutes } from './routes/login.js';
import { keyRoutes } from './routes/keys.js';
import { deviceRoutes } from './routes/devices.js';
import { messageRoutes } from './routes/messages.js';
import { connectRoutes } from './routes/connect.js';
import { userRoutes } from './routes/users.js';
import { contactRoutes } from './routes/contacts.js';
import { accountDataRoutes } from './routes/accountData.js';

// See docs/api/openapi.yaml (HTTP) and docs/api/asyncapi.yaml (WebSocket) for
// the contract this implements, and THREAT_MODEL.md for the trust boundary
// this code has to respect (no plaintext, no long-term keys, ever).

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

// trustProxy defaults to 'loopback' for local dev (Tailscale Serve terminates
// TLS and proxies over 127.0.0.1, setting X-Forwarded-For with the real
// tailnet peer's IP). In production (docker-compose.prod.yml) it's overridden
// via TRUST_PROXY to the compose network's pinned subnet, since Caddy proxies
// over the internal Docker network there, not loopback. Either way, without
// trusting the right source, request.ip collapses every real user into one
// bucket for IP-keyed rate limits — and it's scoped narrowly (not blanket
// `true`) since HOST=0.0.0.0 means this port is also reachable directly; a
// direct caller's forwarded header must stay ignored, only the proxy's own
// connection is trusted.
const app = Fastify({ logger: true, trustProxy: process.env.TRUST_PROXY ?? 'loopback' });

// Wide open for now — this is unexposed LAN-only local dev (see
// Projects/CyCove.md -> Key decisions -> Hosting), not a public deployment.
// Revisit before anything is reachable outside the LAN.
// methods: @fastify/cors defaults to GET,HEAD,POST only — PUT needed once
// /users/username and /account-data/contacts were added (real bug caught
// live: the preflight succeeded but the browser silently refused to send
// the actual PUT since it wasn't in Access-Control-Allow-Methods). DELETE
// needed for the same reason once DELETE /devices/:deviceId was added — this
// is now the second time a new HTTP method got added to a route without
// remembering to add it here too; worth treating "did I add the method to
// CORS" as a standing checklist item for any future non-GET/POST route.
await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] });
await app.register(websocketPlugin);
await app.register(registerRoutes);
await app.register(loginRoutes);
await app.register(keyRoutes);
await app.register(deviceRoutes);
await app.register(messageRoutes);
await app.register(connectRoutes);
await app.register(userRoutes);
await app.register(contactRoutes);
await app.register(accountDataRoutes);

app.get('/health', async () => ({ status: 'ok' }));

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
