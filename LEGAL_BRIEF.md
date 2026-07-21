# CyCove — Brief for Legal Counsel

> Not legal advice, not a substitute for review — this exists to make the first meeting with a lawyer efficient by organizing what's already known and what specifically needs their judgment. Last updated 2026-07-19.

## What CyCove is

A privacy-first, end-to-end encrypted 1:1 messenger (groups planned later). Core differentiators: no phone number or email required to register (random public ID instead), the server is a deliberate "dumb pipe" that never has access to plaintext or long-term keys, and hosting is EU-based specifically to avoid US CLOUD Act exposure. Closed-source, freemium (paid tier unlocks multi-device sync and larger storage — core encryption is identical on both tiers). Currently pre-launch: architecture and core crypto verified working in a local test build, no real users yet.

## What kind of counsel this needs

Data protection / GDPR specialist, ideally with EU tech regulatory experience (DSA, ePrivacy) — a generalist commercial lawyer likely isn't the right fit given how much of this product's design is *shaped by* privacy law, not just subject to it. German qualification is the natural fit since incorporation is planned in Germany (matches the hosting jurisdiction — Hetzner, Germany). Prior experience with encrypted messaging, age-verification, or similar privacy-first products would be a genuine bonus given the specific questions below, but isn't a hard requirement.

## Specific open questions, by document

### Trademark — `CyCove` name clearance
Preliminary search done (2026-07-18): no exact match in USPTO TESS or EUIPO TMview, `cycove.com`/`cycove.app` both available, no exact-name match on the App Store or Google Play. **Not a substitute for a formal attorney opinion before filing.** Specifically flag: **Cove Identity App**, a real EU/India-based E2EE storage & communications company, uses the adjacent root word "Cove" in the same privacy/security space — no direct conflict found, but worth a second look given how close the space is. Fallback name if this doesn't clear: **Olvix**.

### Privacy Policy & Terms of Service
Drafted as section-by-section outlines, not final text — see `PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` in this repo. Each has its own "open questions for the lawyer pass" section at the bottom. The one worth flagging up front: since there's no email or phone tied to an account, *how does a user prove ownership to exercise GDPR rights (access/erasure/portability)?* Current best guess is the recovery key, but that's a design question as much as a legal one, and needs to be settled with input from both sides.

### Age verification
Researched, not decided (2026-07-19) — GDPR Article 8 sets a default digital-consent age of 16, but member states can set it as low as 13 (Germany's own threshold needs confirming as part of this — the research so far covered Finland, Estonia, Spain, Greece, Czechia as examples, not Germany specifically). Separately, the EU's Digital Services Act has a privacy-preserving age-verification blueprint in pilot rollout that explicitly covers messaging apps — plausibly a good long-term fit given CyCove's no-phone/email model, but adoption timeline is unclear. Needs a decision: ship with a self-declared age gate now, or wait for the EU framework to mature — and what CyCove's actual legal exposure is in the interim.

### Data Processing Agreements
Needed with the hosting provider (Hetzner, Germany — decided but not yet provisioned) and, once chosen, a payment processor for the paid tier. Neither is in place yet.

### Data Protection Officer
Open question: is one required for a product this privacy-sensitive, independent of the headcount thresholds that normally trigger the requirement?

### Incorporation
Germany (decided 2026-07-19). GmbH vs. UG (haftungsbeschränkt) vs. other structure not yet decided — outside pure data-protection scope but the counsel search should probably factor in whether the same firm handles this or it needs a separate corporate lawyer.

## Ongoing regulatory watch (no action needed yet, just context)
EU's CSA Regulation ("Chat Control 2.0") is still in trilogue — no current mandate to break E2EE, next round expected September 2026. Chat Control 1.0's voluntary scanning derogation was renewed through April 2028 and explicitly excludes E2EE communications. Worth a status check whenever counsel is engaged, since this moves independently of CyCove's own timeline.

## Related
- `PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md` — the drafts this brief supports
- `THREAT_MODEL.md` — technical security posture, useful context for the DPA/DPO questions
- Vault note `Projects/CyCove.md` → Legal & compliance notes — the fuller version of the age-verification research
