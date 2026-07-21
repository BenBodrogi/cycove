# CyCove Wireframes

> Low-fidelity structure for the four screens flagged in the Phase 0 plan: registration/recovery-key reveal, device linking (QR pairing), chat UI, and safety-number verification. Rendered version: https://claude.ai/code/artifact/ce4e3492-182e-4c53-a4da-ae3eae92b54b (private artifact link — re-render from this doc if it's ever unreachable). Layout only, no visual design decided. Draft — 2026-07-18.

## 01 — Registration / recovery key reveal (Phase 1)
- Blunt headline: "This is the only way to recover your account. We cannot reset it for you."
- Word-list recovery phrase, generated client-side — server only ever sees a hash.
- "Copy" and "I've saved this" are separate actions, not one dismiss.
- **Open:** forced re-entry of 3 random words before continuing, to catch an unsaved phrase before it's too late — exact mechanism undecided.

## 02 — Device linking / QR pairing (Phase 1)
- Personal QR code encodes public ID + a short-lived nonce, not raw key material.
- In-app scanner on the other device reads it; both sides get a connection confirmation.
- "Verify now" prompt chains straight into safety-number verification (screen 04) while both devices are physically present.
- **Open:** share-link fallback for remote adds, which should default to "unverified" until checked in-app.

## 03 — Chat UI, 1:1 conversation (Phase 1)
- Header shows a local-only nickname and a verification indicator — never a phone number.
- Received bubbles vs. sent-pending-ack bubbles are visually distinct.
- Composer reflects free-tier limits (images-only, size cap) at send time, not after an upload fails.

**Built (2026-07-19):** multi-contact sidebar + conversation view, `web/app/ClientApp.tsx` + `web/app/components/`. Sent/delivered/read now all three real states — the recipient sends back an encrypted `m.cycove.receipt` on decrypt and a separate `m.cycove.read` once that conversation is actually open (same generic to-device mechanism as everything else, see `docs/crypto-integration-notes.md`); sent bubbles progress "✓ sent" → "✓✓ delivered" → "✓✓ read". Live "`<name>` is typing…" indicator (`m.cycove.typing`, ephemeral — not persisted, not part of message history, auto-clears if a stop event is lost). Per-contact local-only avatars (small canvas-resized image, never transmitted) alongside the nickname, both editable after the fact via a per-row edit affordance. Contacts, nicknames, avatars, and message history all persist across reloads (sessionStorage, per-tab). **Verification indicator became a hard gate, not just a badge, same day** — the composer is replaced by a "verify to start messaging" call to action until that contact is actually verified; see `THREAT_MODEL.md` → MITM at first contact. Composer is text-only — free-tier limits (images-only, size cap) deliberately not built yet, tied to the separate unbuilt freemium-gating item.

## 04 — Safety-number verification (Phase 1.1, not MVP-blocking)
- Derived fingerprint shown as a numeric/word grid, compared out-of-band (in person, a call) — never through CyCove itself.
- Two explicit outcomes: match / doesn't match, not a single "confirm" that assumes success.
- **Built 2026-07-19, made mandatory before messaging the same day.** Fingerprint is a 7-emoji sequence rather than a numeric/word grid (`Sas.emoji()`'s native output — a grid would mean re-deriving and re-encoding the same fingerprint, not a real functional difference). Match/don't-match are two explicit buttons, not one "confirm." No longer just screen 03's optional badge — this screen is now unavoidable on the way to actually messaging someone. See `THREAT_MODEL.md` → MITM at first contact.

## Related
- `docs/ux-flows.md` — the flow logic behind screens 01 and 02
- `THREAT_MODEL.md` — MITM at first contact (screen 04), recovery key loss/theft (screen 01)
- `docs/api/openapi.yaml` — `/register`, `/devices/link`
- `Projects/CyCove.md` (vault) — product scope and architecture
