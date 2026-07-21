# CyCove Terms of Service

> **DRAFT OUTLINE — not final legal text.** Same status as `PRIVACY_POLICY.md` in this repo: a scaffold for what needs deciding, not something to ship. A lawyer needs to review and finalize. Last updated 2026-07-18.

## What this needs to say, section by section

### 1. Acceptance & eligibility
Minimum age to use the service — blocked on the same age-verification question (see Legal & compliance notes in `Projects/CyCove.md`) as the privacy policy. Don't finalize independently of that decision.

### 2. The service
Plain description: E2EE 1:1 messaging (Phase 1), groups later (Phase 2), Android + Web at launch, iOS deferred (Phase 3) — see `Projects/CyCove.md` for current scope.

### 3. Accounts
- Random-ID registration, no phone/email required.
- User is solely responsible for safeguarding their recovery key — state plainly that a lost recovery key with no linked device means a lost account, with no phone/email fallback for support to use to restore access. This needs to be unambiguous and prominent, not buried — it's a real support liability if users aren't warned clearly.
- Right to suspend/terminate accounts for abuse (rate-limit violations, spam, illegal content relay attempts) — needs concrete criteria once the rate-limiting/abuse strategy (an open item in `Projects/CyCove.md` → Architecture → Backend) is designed.

### 4. Acceptable use
Standard prohibited-use list (illegal content, harassment, spam/abuse of the relay, attempts to circumvent encryption or extract other users' keys). Because the server can't see message content, enforcement is necessarily based on behavioral/metadata signals (rate, volume, reports) rather than content moderation — say this explicitly so it's clear what CyCove can and can't police, and why.

### 5. Subscriptions & billing (paid tier)
- Freemium model: free tier terms per the Free tier limits decision in `Projects/CyCove.md` (1GB/chat, 5GB account ceiling, images-only, 10MB max image, 10,000-char messages).
- Paid tier: multi-device sync, larger media limits, encrypted backup — exact pricing still TBD (see Open questions in `Projects/CyCove.md`).
- Cancellation, refund policy, auto-renewal disclosure — standard clauses, need the payment processor chosen first.
- Hard rule to state explicitly: core E2EE security is identical on both tiers — the paywall never gates encryption itself. This is a product commitment worth putting in the ToS, not just the privacy policy, since it's a trust claim users may rely on.

### 6. Intellectual property
Standard closed-source clause — CyCove is closed-source (per the Crypto library decision in `Projects/CyCove.md`, chosen partly *because* it allows staying closed-source without an AGPL conflict). State clearly what is and isn't licensed to the user (the service, not the software).

### 7. Disclaimers & limitation of liability
Standard SaaS boilerplate, plus a specific one worth flagging to counsel: given the "dumb pipe" architecture (server never holds plaintext or long-term keys — see `Projects/CyCove.md` → Architecture → Backend), CyCove has a genuinely strong technical basis for limiting liability around message content/loss in ways some competitors can't claim as credibly. Worth using that honestly rather than generic boilerplate.

### 8. Termination
User-initiated account deletion mechanics — ties back to the same "no phone/email fallback" consideration as account recovery.

### 9. Governing law & disputes
EU jurisdiction, consistent with the hosting/data-residency positioning (see Hosting in `Projects/CyCove.md`) — specific country TBD once the entity is incorporated.

### 10. Changes to these terms
Same notice-mechanism question as the privacy policy (no reliable email channel for most users — in-app notice is likely the only option).

## Open questions for the lawyer pass
- Whether EU consumer-protection rules (e.g. right of withdrawal for digital subscriptions) impose specific cancellation/refund mechanics beyond generic boilerplate.
- Age-eligibility clause, pending age verification resolution (see `Projects/CyCove.md` → Legal & compliance notes).
- Content-moderation/legal-request handling process — what CyCove does (and, given the architecture, largely *can't* do) when it receives a takedown or law-enforcement request for message content it never had access to.
