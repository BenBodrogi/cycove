# CyCove Privacy Policy

> **DRAFT OUTLINE — not final legal text.** This exists to pin down what the policy needs to cover, based on decisions already made in the vault (`Projects/CyCove.md` in the Virdana Obsidian vault), so the data model gets designed against real constraints instead of retrofitting privacy claims after the fact. A lawyer needs to review and finalize before this ships or gets linked from the app. Last updated 2026-07-18.

## What this needs to say, section by section

### 1. Who we are
Virdana (studio) / CyCove (product). EU-domiciled hosting (see Hosting decision in `Projects/CyCove.md`) — state the legal entity and jurisdiction once incorporation details exist.

### 2. What we collect
- **Account:** a randomly generated public ID. No phone number, no email, no name, by design (see the Identity model decision in `Projects/CyCove.md`).
- **Recovery key:** generated client-side at registration, shown once. We never see it in plaintext and never store it — say this explicitly and clearly, it's the core trust claim.
- **Device keys:** public identity keys, signed prekeys, one-time prekeys per device — public key material only, never private keys.
- **Message content:** never — end-to-end encrypted, server only ever holds ciphertext, and only transiently (deleted immediately on delivery ack). State plainly that we cannot read messages even if compelled to.
- **Metadata we do handle operationally:** which device has a push token (for FCM wake-ups), last-seen timestamps for prekey/session bookkeeping, storage-quota usage per the free/paid tiers (see the Free tier limits decision in `Projects/CyCove.md`). Be explicit that this is less metadata than typical messengers (no contact-list upload, no phone-number-based social graph) but not zero — don't overclaim "we collect nothing."
- **Payment data (paid tier):** handled by a third-party payment processor, not stored by CyCove directly — name the processor once chosen.
- **Push notifications:** FCM (Android). The payload is an opaque wake signal only, no message content or sender/recipient identifiers — say this explicitly since it's a common area of confusion (people assume push = content leak).

### 3. What we don't do
- No server-side message logging, ever, at any layer.
- No advertising, no data sale, no third-party analytics/telemetry SDKs (mirror Pulse's "no telemetry" hard rule — see the Conventions to follow when extending section of `Projects/Pulse.md` for the pattern to match in tone).
- No contact list upload / no phone-number-based contact discovery (trade-off of the identity model — explain this as a deliberate privacy choice, not a missing feature).

### 4. Legal basis & retention
- GDPR legal basis for processing (contract performance for account/device data; legitimate interest or consent for anything else that gets added later).
- Retention: ciphertext deleted on delivery; account data retained until account deletion; specify a concrete retention window once decided.
- **Age verification / minors:** flag as pending — see Legal & compliance notes in `Projects/CyCove.md`. Do not finalize this section until that question is resolved with counsel.

### 5. User rights (GDPR)
Access, rectification, erasure, portability, objection — standard boilerplate once legal reviews, but the concrete mechanics matter here: since there's no email/phone tied to the account, describe *how* a user proves account ownership to exercise these rights (likely: the recovery key, or an authenticated in-app request). This is a real design question, not just a legal one — flag it back to the Identity model section's open recovery-UX question in `Projects/CyCove.md`.

### 6. International transfers
None expected — hosting is EU-only by design (see Hosting in `Projects/CyCove.md`). State this as a positioning point once the provider/region is finalized.

### 7. Security
High-level description of E2EE (Double Ratchet / Megolm via vodozemac), without so much technical detail it becomes a target map — link out to a public-facing summary of the crypto architecture (`Projects/CyCove.md` → Architecture → Crypto) rather than reproducing implementation detail here.

### 8. Changes to this policy
Standard notice-of-changes clause — decide the notice mechanism (in-app banner vs. email — note email may not exist for most users, so in-app is likely the only reliable channel).

### 9. Contact
Needs a real contact address/entity once available.

## Open questions for the lawyer pass
- Exact retention windows (account data after deletion, backups, logs).
- Data Processing Agreement needs with the hosting provider and (once chosen) payment processor.
- Whether a DPO (Data Protection Officer) is required given the privacy-sensitive nature of the product, independent of headcount thresholds.
- How the age-verification approach (see Legal & compliance notes in `Projects/CyCove.md`) feeds back into what this policy can claim about minors.
