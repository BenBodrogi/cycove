# CyCove

Privacy-first, end-to-end encrypted messenger. A Virdana product — working title, name pending formal trademark clearance (see `PRIVACY_POLICY.md` and the vault note below for status).

**Status: Phase 1 backend done and verified.** The backend's full HTTP + WebSocket surface for 1:1 messaging is implemented and tested end-to-end against a live Postgres/Redis (2026-07-19) — account/device registry, prekeys, the WS relay. Not built yet: the Android and Web clients, crypto integration, and FCM push. See "Getting started" below.

## Full context

The canonical product context — architecture, decisions, open questions — lives in the Virdana Obsidian vault, not this repo:

```
C:\Users\bodro\OneDrive\Documents\VirdanaVault\VirdanaVault\Projects\CyCove.md
```

Start there. This repo's `.claude/plan.md` and `.claude/handoff-2026-07-18.md` are duplicated from the vault for session continuity.

## Layout

```
cycove/
├── backend/          Node.js/TypeScript relay (Fastify). "Dumb pipe" — no cryptography, no plaintext.
├── web/               Next.js web client.
├── docs/
│   ├── api/           OpenAPI (HTTP) + AsyncAPI (WebSocket) contracts — draft, will drift once implementation starts.
│   ├── ux-flows.md    Recovery-key and contact-adding flow design.
│   └── wireframes.md  Low-fidelity wireframes for the core screens.
├── PRIVACY_POLICY.md      Draft outline, not final legal text.
├── TERMS_OF_SERVICE.md    Draft outline, not final legal text.
└── THREAT_MODEL.md        Assets, trust boundaries, threats, mitigations.
```

**Android is not in this repo.** It's Kotlin/Compose with no code to share with the TypeScript backend/web workspaces, so it'll live in its own repo once Android work starts (Phase 1).

## Why a monorepo for backend + web

The backend is TypeScript specifically so it can share types/validation schemas with the Next.js web client (see the Backend language decision in the vault note) — a monorepo makes that sharing straightforward. `npm` workspaces, no extra build-orchestration tool added yet; revisit (e.g. Turborepo) only if build times become a real problem.

## Getting started

`npm install` at the repo root resolves dependencies for both workspaces. `web/` still has a placeholder `src/index.ts` (no real app logic yet). `backend/` now has a real Fastify app shell:

1. Install Docker Desktop for Windows — needs WSL2 (`wsl --install` as Administrator, then restart) if it isn't already present.
2. Copy `backend/.env.example` to `backend/.env` — `DATABASE_URL`/`REDIS_URL` default to `localhost`, which is correct now that Postgres/Redis and the backend all run on the same machine.
3. Start Postgres + Redis: `docker compose up -d`.
4. First time only: `npx prisma migrate dev --name init` (inside `backend/`) to create the tables.
5. `npm run dev --workspace=backend` — boots the server on `PORT` (default 3000), `GET /health` returns `{"status":"ok"}`.

(Earlier plan was Postgres/Redis on the Synology NAS via Container Manager — abandoned 2026-07-19 once the backend was confirmed to stay on Windows; splitting the two across machines added a network hop and DSM-specific friction for no benefit. See `Projects/CyCove.md` -> Key decisions -> Hosting.)

What's implemented (`backend/src/routes/`, matches `docs/api/openapi.yaml` + `asyncapi.yaml`):
- `POST /register` — account + first device, issues a bearer session token
- `POST /devices/pairing-token` + `POST /devices/link` — multi-device linking
- `POST /prekeys` + `GET /prekeys/:userId` — one-time prekey upload and atomic claim-and-consume
- `POST /messages` — HTTP fallback send
- `GET /v1/connect` (WebSocket) — the realtime relay: connect, authenticate via the first message (not a header — native browser WebSocket can't set one), send/receive ciphertext, ack delivery, get queued messages flushed on connect

What's not: Firebase push wake-up (needs credentials — see `backend/.env.example`), rate limiting, and anything client-side.

**Verified end-to-end against a live Postgres/Redis (2026-07-19)**: first real migration applied, both accounts registered, prekey upload + atomic claim-and-consume (a second fetch correctly 404s — the race-safety logic actually works), pairing-token issuance + device linking + single-use enforcement, and the full WS relay — auth handshake, live `sendCiphertext`→`deliverCiphertext` between two real WebSocket clients, `deliveryAck` confirmed via a direct database check to actually delete the row, and the offline path (`POST /messages` while the recipient was disconnected, delivered via `queueFlush` on reconnect). Test data cleared afterward.

Known issue: `npm audit` flags a moderate XSS advisory in a transitive `postcss` dependency pulled in by `next`. Not fixed here — npm's suggested fix downgrades to an ancient Next.js version, which is worse. Revisit dependency versions when Phase 1 web work actually starts.

## CI

`.github/workflows/ci.yml` runs typecheck + lint on push/PR, and builds `backend` (verified passing locally). No `build-web` job yet (needs a real Next.js app scaffold first) and no deploy job yet (needs a provisioned VPS and a Dockerfile first).
