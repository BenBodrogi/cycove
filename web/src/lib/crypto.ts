import {
  OlmMachine,
  UserId,
  DeviceId,
  DeviceLists,
  initAsync,
  type VerificationRequest,
  type Sas,
} from '@matrix-org/matrix-sdk-crypto-wasm';
import type { ChatMessage } from './store';

// Most-recent messages per contact included in one history-sync bundle when
// an already-established device pushes its history to a newly linked
// sibling — confirmed comfortably under every real limit in the stack
// (~40KB raw JSON for 200 realistic messages) by a grounding script, see
// docs/crypto-integration-notes.md.
const HISTORY_SYNC_MESSAGE_CAP = 200;

// Wraps matrix-sdk-crypto-wasm's OlmMachine against CyCove's backend.
// See docs/crypto-integration-notes.md for the ground-truthed shapes this
// is built on, and Projects/CyCove.md -> Key decisions -> Crypto library for
// why this library was chosen over a lower-level alternative.
//
// Deliberately simplified for a first working version (real gaps, not
// oversights — see docs/crypto-integration-notes.md):
// - No IndexedDB store passphrase yet (Web client storage security posture
//   is a tracked open question in Projects/CyCove.md).
// - No live one-time-key-count tracking or device-list-change tracking.
// - sessionStorage (not localStorage) for session bookkeeping, deliberately
//   — testing with two accounts in two tabs of the same browser needs
//   per-tab isolation, which localStorage (shared per-origin) doesn't give.
//   Revisit for real multi-device/single-account use once past this test.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000';
const SESSION_STORAGE_KEY = 'cycove_session';

let wasmReady: Promise<void> | null = null;
function ensureWasmInit(): Promise<void> {
  wasmReady ??= initAsync();
  return wasmReady;
}

interface StoredSession {
  userId: string;
  deviceId: string;
  sessionToken: string;
}

function persistSession(session: StoredSession): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function loadSession(): StoredSession | null {
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as StoredSession) : null;
}

/** Ends the session in this tab — logging out. The account and its keys are untouched (see CyCoveCrypto.login). */
export function clearSession(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.removeItem(BACKUP_KEY_STORAGE_KEY);
}

async function apiFetch(path: string, sessionToken: string | null, options?: { method?: string; body?: unknown }): Promise<any> {
  const hasBody = options?.body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    method: options?.method ?? 'POST',
    headers: {
      // Fastify's default JSON body parser rejects Content-Type:
      // application/json on a request with no body at all
      // (FST_ERR_CTP_EMPTY_JSON_BODY) — only send it when there's an actual
      // body to parse. First bodyless POST call was requestPairingCode();
      // every earlier apiFetch call always passed a real body.
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} failed: HTTP ${res.status} ${text}`);
  }
  if (res.status === 204 || res.status === 202) return undefined;
  return res.json();
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Contact backup — the recovery key already has ~244 bits of entropy
// (crypto.randomUUID() x2, see ClientApp.tsx), so a fixed PBKDF2 salt is a
// reasonable simplification here: the salt exists to defeat precomputation
// against *low*-entropy human passwords, not a concern with a secret this
// large. Not derived per-user-random since the salt would then need
// server-side storage to re-derive the same key later, adding a moving
// part for no real security benefit at this entropy level.
const BACKUP_KEY_SALT = 'cycove-contact-backup-v1';
const BACKUP_KEY_STORAGE_KEY = 'cycove_backup_key';

async function deriveBackupKey(recoveryKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(recoveryKey), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(BACKUP_KEY_SALT), iterations: 210_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // extractable — persisted below so normal use never re-prompts for the recovery key
    ['encrypt', 'decrypt'],
  );
}

async function persistBackupKey(key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem(BACKUP_KEY_STORAGE_KEY, arrayBufferToBase64(raw));
}

async function loadBackupKey(): Promise<CryptoKey | null> {
  const raw = sessionStorage.getItem(BACKUP_KEY_STORAGE_KEY);
  if (!raw) return null;
  return crypto.subtle.importKey('raw', base64ToArrayBuffer(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

/**
 * What handleIncoming found, for the UI to react to. Contact
 * request/accept/decline are NOT handled here — they never reach the
 * OlmMachine at all, see the note on sendContactRequest/sendPlain below.
 */
export type IncomingResult =
  | { kind: 'message'; id: string; text: string }
  | { kind: 'receipt'; messageId: string }
  | { kind: 'read'; messageId: string }
  | { kind: 'typing'; state: 'start' | 'stop' }
  | { kind: 'history_sync'; contactUserId: string; messages: ChatMessage[] }
  | { kind: 'none' };

export class CyCoveCrypto {
  /** Set once by the UI layer after both this and the RelayConnection exist — see ClientApp.tsx. */
  private sender: ((deviceId: string, eventType: string, content: unknown) => void) | null = null;

  private constructor(
    private readonly machine: OlmMachine,
    public readonly userId: string,
    public readonly deviceId: string,
    private readonly sessionTokenValue: string,
    private readonly backupKey: CryptoKey | null,
  ) {}

  /** Needed by the WS relay connection (RelayConnection), which authenticates independently of this class. */
  get sessionToken(): string {
    return this.sessionTokenValue;
  }

  /** The crypto module can't send anything on its own — it needs the relay connection wired in once one exists. */
  attachSender(fn: (deviceId: string, eventType: string, content: unknown) => void): void {
    this.sender = fn;
  }

  /** Creates a brand-new account: generates keys, registers with the backend. Takes the *raw* recovery key (only the server-facing hash leaves this function) — needed here now, not just for the API call, since the contact-backup key is derived from it too. */
  static async register(recoveryKey: string): Promise<CyCoveCrypto> {
    await ensureWasmInit();

    const userId = `@${crypto.randomUUID()}:cycove.local`;
    const deviceId = crypto.randomUUID();

    const machine = await OlmMachine.initialize(
      new UserId(userId),
      new DeviceId(deviceId),
      `cycove-${deviceId}`, // per-device IndexedDB store — see file header re: multi-tab testing
    );

    const initialRequests = await machine.outgoingRequests();
    const uploadReq = initialRequests.find((r) => r.constructor.name === 'KeysUploadRequest');
    if (!uploadReq || !('body' in uploadReq) || !uploadReq.id) {
      throw new Error('Expected a KeysUploadRequest (with an id) immediately after OlmMachine.initialize()');
    }
    const uploadBody = JSON.parse(uploadReq.body as string) as {
      device_keys: unknown;
      one_time_keys: Record<string, unknown>;
    };

    const result = await apiFetch('/register', null, {
      body: {
        user_id: userId,
        device_id: deviceId,
        recovery_key_hash: await sha256Hex(recoveryKey),
        device_keys: uploadBody.device_keys,
        one_time_keys: uploadBody.one_time_keys,
      },
    });

    await machine.markRequestAsSent(
      uploadReq.id,
      uploadReq.type,
      JSON.stringify({ one_time_key_counts: result.one_time_key_counts }),
    );

    const backupKey = await deriveBackupKey(recoveryKey);
    await persistBackupKey(backupKey);

    const instance = new CyCoveCrypto(machine, userId, deviceId, result.session_token, backupKey);
    await instance.processOutgoingRequests(); // handles the self-KeysQueryRequest observed during testing

    persistSession({ userId, deviceId, sessionToken: result.session_token });
    return instance;
  }

  /** Re-attaches to an existing account from this tab's sessionStorage, if any. */
  static async restore(): Promise<CyCoveCrypto | null> {
    const stored = loadSession();
    if (!stored) return null;

    await ensureWasmInit();
    const machine = await OlmMachine.initialize(
      new UserId(stored.userId),
      new DeviceId(stored.deviceId),
      `cycove-${stored.deviceId}`,
    );
    const backupKey = await loadBackupKey();
    return new CyCoveCrypto(machine, stored.userId, stored.deviceId, stored.sessionToken, backupKey);
  }

  /**
   * Re-authenticates an existing account on *this* device — restores the
   * session, not the identity, since the identity (private keys) never left
   * this browser's IndexedDB in the first place if it's really here. Detects
   * the case where it isn't (a genuinely different browser) rather than
   * silently generating a mismatched new identity — see the
   * KeysUploadRequest check below and docs/ux-flows.md.
   */
  static async login(username: string, recoveryKey: string): Promise<CyCoveCrypto> {
    await ensureWasmInit();

    const result = await apiFetch('/login', null, {
      body: { username, recovery_key_hash: await sha256Hex(recoveryKey) },
    });
    const { user_id: userId, device_id: deviceId, session_token: sessionToken } = result;

    const machine = await OlmMachine.initialize(new UserId(userId), new DeviceId(deviceId), `cycove-${deviceId}`);

    // A fresh/empty IndexedDB store always has a pending KeysUploadRequest
    // right after initialize() — that's how register() (above) knows to
    // upload initial keys. If one shows up here, this browser has never seen
    // this device's real keys: the server already has different ones on file
    // from wherever this account was actually created. Refuse rather than
    // silently proceeding with a mismatched identity — see ClientApp.tsx's
    // handleLogin for how this specific error routes the user to linking.
    const pending = await machine.outgoingRequests();
    if (pending.some((r) => r.constructor.name === 'KeysUploadRequest')) {
      throw new Error('KEYS_NOT_ON_THIS_DEVICE');
    }

    const backupKey = await deriveBackupKey(recoveryKey);
    await persistBackupKey(backupKey);

    const instance = new CyCoveCrypto(machine, userId, deviceId, sessionToken, backupKey);
    persistSession({ userId, deviceId, sessionToken });
    return instance;
  }

  /**
   * Links *this* browser as a new device on an existing account — a
   * genuinely new set of keys, not a copy of an existing device's (no real
   * cross-signing yet, so this device starts unverified to every existing
   * contact — see THREAT_MODEL.md). Consumes a single-use pairing token
   * generated by an already-logged-in device via requestPairingCode().
   * recoveryKey is optional: without it this device still works for
   * messaging going forward, it just can't decrypt the existing contacts
   * backup (same key derivation register()/login() use).
   */
  static async linkDevice(userId: string, pairingToken: string, recoveryKey?: string): Promise<CyCoveCrypto> {
    await ensureWasmInit();

    const deviceId = crypto.randomUUID();
    const machine = await OlmMachine.initialize(new UserId(userId), new DeviceId(deviceId), `cycove-${deviceId}`);

    const initialRequests = await machine.outgoingRequests();
    const uploadReq = initialRequests.find((r) => r.constructor.name === 'KeysUploadRequest');
    if (!uploadReq || !('body' in uploadReq) || !uploadReq.id) {
      throw new Error('Expected a KeysUploadRequest immediately after OlmMachine.initialize()');
    }
    const uploadBody = JSON.parse(uploadReq.body as string) as {
      device_keys: unknown;
      one_time_keys: Record<string, unknown>;
    };

    const result = await apiFetch('/devices/link', null, {
      body: {
        pairing_token: pairingToken,
        device_id: deviceId,
        device_keys: uploadBody.device_keys,
        one_time_keys: uploadBody.one_time_keys,
      },
    });

    await machine.markRequestAsSent(
      uploadReq.id,
      uploadReq.type,
      JSON.stringify({ one_time_key_counts: result.one_time_key_counts }),
    );

    const backupKey = recoveryKey ? await deriveBackupKey(recoveryKey) : null;
    if (backupKey) await persistBackupKey(backupKey);

    const instance = new CyCoveCrypto(machine, userId, deviceId, result.session_token, backupKey);
    await instance.processOutgoingRequests(); // handles the self-KeysQueryRequest, same as register()

    persistSession({ userId, deviceId, sessionToken: result.session_token });
    return instance;
  }

  /**
   * Relays one OutgoingVerificationRequest (or the ToDeviceRequest returned
   * alongside a fresh VerificationRequest/Sas) via the attached sender.
   * These come back as direct return values from verification methods, not
   * through outgoingRequests() — no markRequestAsSent needed for them.
   */
  private relayOutgoing(out: { constructor: { name: string }; body?: string; event_type?: string } | undefined): void {
    if (!out || out.constructor.name !== 'ToDeviceRequest' || !out.body || !out.event_type) return;
    const body = JSON.parse(out.body) as { messages: Record<string, Record<string, unknown>> };
    for (const devices of Object.values(body.messages)) {
      for (const [deviceId, content] of Object.entries(devices)) {
        this.sender?.(deviceId, out.event_type, content);
      }
    }
  }

  /** Dispatches whatever OlmMachine currently wants to send, against the matching backend endpoint (or the relay, for ToDeviceRequests). */
  private async processOutgoingRequests(): Promise<void> {
    const requests = await this.machine.outgoingRequests();
    for (const req of requests) {
      if (!req.id) continue; // e.g. a SignatureUploadRequest outside interactive verification — not used here, can't ack without an id anyway
      const body = 'body' in req ? JSON.parse(req.body as string) : undefined;
      let response: unknown = {};

      switch (req.constructor.name) {
        case 'KeysUploadRequest':
          response = await apiFetch('/keys/upload', this.sessionToken, { body });
          break;
        case 'KeysQueryRequest':
          response = await apiFetch('/keys/query', this.sessionToken, { body });
          break;
        case 'KeysClaimRequest':
          response = await apiFetch('/keys/claim', this.sessionToken, { body });
          break;
        case 'ToDeviceRequest':
          // Verification's key/mac/done steps arrive here as a side effect
          // of processing an incoming event, not as a direct return value —
          // see docs/crypto-integration-notes.md. Actually relay them now
          // (this used to be a no-op stub before verification existed).
          this.relayOutgoing(req as unknown as { constructor: { name: string }; body?: string; event_type?: string });
          response = {};
          break;
        default:
          response = {};
      }

      await this.machine.markRequestAsSent(req.id, req.type, JSON.stringify(response));
    }
  }

  /** Makes sure we have (or establish) an Olm session with a peer before encrypting to them. */
  async ensureSessionWith(peerUserId: string): Promise<void> {
    await this.machine.updateTrackedUsers([new UserId(peerUserId)]);
    // updateTrackedUsers alone doesn't force a re-query for an ALREADY
    // tracked user — CyCove has no device-list-change push from the server,
    // so force a fresh device list on every call instead (confirmed
    // necessary by a grounding script — see docs/crypto-integration-notes.md's
    // cross-signing section — otherwise a contact's newly linked device can
    // stay invisible indefinitely). A little extra /keys/query traffic per
    // session-establish, acceptable at this scale.
    await this.machine.receiveSyncChanges(JSON.stringify([]), new DeviceLists([new UserId(peerUserId)]), new Map());
    await this.processOutgoingRequests(); // resolves the KeysQueryRequest this triggers

    const claimReq = await this.machine.getMissingSessions([new UserId(peerUserId)]);
    if (claimReq) {
      const body = JSON.parse(claimReq.body);
      const response = await apiFetch('/keys/claim', this.sessionToken, { body });
      await this.machine.markRequestAsSent(claimReq.id, claimReq.type, JSON.stringify(response));
    }
  }

  /**
   * Every currently-known device of a contact worth sending to — confirmed
   * via a grounding script that ensureSessionWith (via getMissingSessions)
   * already establishes sessions with all of them, not just one, so this is
   * purely an enumeration step. Filtered to isVerified() devices, which
   * cross-signing already makes true for every device of a verified
   * identity, not just whichever one was originally SAS'd — see
   * docs/crypto-integration-notes.md. Call ensureSessionWith first.
   */
  private async getContactDevices(peerUserId: string): Promise<string[]> {
    const userDevices = await this.machine.getUserDevices(new UserId(peerUserId));
    return userDevices
      .devices()
      .filter((d) => d.isVerified())
      .map((d) => d.deviceId.toString());
  }

  // ---- Cross-signing — see docs/crypto-integration-notes.md's cross-signing
  // grounding section for the real request shapes and call sequence this is
  // built on. Solves two disclosed gaps: linked devices inheriting no trust
  // (THREAT_MODEL.md), and SAS verification being per-device instead of
  // per-identity (docs/ux-flows.md).

  /**
   * Ensures this account has cross-signing keys, bootstrapping them on first
   * use. Cheap no-op if already bootstrapped (checked locally), safe to call
   * defensively on every login/register.
   *
   * Four upload steps, not the library's three — confirmed by grounding that
   * bootstrapCrossSigning() alone does NOT mark this device
   * isCrossSignedByOwner(); a follow-up OwnUserIdentity.verify() call (which
   * signs the master key with this device, the other half of the trust
   * link) is required too.
   */
  async bootstrapCrossSigningIfNeeded(): Promise<void> {
    const status = await this.machine.crossSigningStatus();
    if (status.hasMaster && status.hasSelfSigning && status.hasUserSigning) return;

    const bootstrap = await this.machine.bootstrapCrossSigning(false);

    if (bootstrap.uploadKeysRequest) {
      const req = bootstrap.uploadKeysRequest;
      const response = await apiFetch('/keys/upload', this.sessionToken, { body: JSON.parse(req.body) });
      await this.machine.markRequestAsSent(req.id, req.type, JSON.stringify(response));
    }

    await apiFetch('/keys/signing-keys/upload', this.sessionToken, {
      body: JSON.parse(bootstrap.uploadSigningKeysRequest.body),
    });
    await apiFetch('/keys/signatures/upload', this.sessionToken, {
      body: JSON.parse(bootstrap.uploadSignaturesRequest.body),
    });

    const ownIdentity = await this.machine.getIdentity(new UserId(this.userId));
    if (ownIdentity) {
      const verifyReq = await ownIdentity.verify();
      await apiFetch('/keys/signatures/upload', this.sessionToken, { body: JSON.parse(verifyReq.body) });
    }

    await this.backUpCrossSigningKeys();
  }

  private async backUpCrossSigningKeys(): Promise<void> {
    const exported = await this.machine.exportCrossSigningKeys();
    if (!exported) return;
    await this.encryptAndUploadBackup('cross-signing', {
      masterKey: exported.masterKey,
      selfSigningKey: exported.self_signing_key,
      userSigningKey: exported.userSigningKey,
    });
  }

  /**
   * Restores the private cross-signing keys from the encrypted backup —
   * needed on a newly linked device (register()/login() already have them
   * locally, generated in place on this device). No-op if there's no backup
   * key (no recovery key was supplied while linking) or nothing's been
   * backed up yet.
   */
  async restoreCrossSigningKeys(): Promise<void> {
    const stored = await this.fetchAndDecryptBackup<{
      masterKey?: string;
      selfSigningKey?: string;
      userSigningKey?: string;
    }>('cross-signing');
    if (!stored) return;
    await this.machine.importCrossSigningKeys(stored.masterKey ?? null, stored.selfSigningKey ?? null, stored.userSigningKey ?? null);
  }

  /**
   * Signs any of this account's OTHER devices that aren't cross-signed yet.
   * This — not the new device signing itself — is the actual mechanism by
   * which a newly linked device inherits trust (confirmed via grounding).
   * No-op if this device doesn't hold the private self-signing key (e.g. a
   * linked device that was never given the recovery key).
   *
   * Returns the IDs of any devices freshly signed by this call — a device
   * only ever appears here once (it won't be "not yet cross-signed" again
   * on a later call), which is what the caller uses to push local data
   * (history-sync, below) to a newly discovered sibling exactly once,
   * rather than repeatedly on every reconcile.
   */
  async reconcileOwnDevices(): Promise<string[]> {
    const status = await this.machine.crossSigningStatus();
    if (!status.hasSelfSigning) return [];

    const ownUserId = new UserId(this.userId);
    await this.machine.receiveSyncChanges(JSON.stringify([]), new DeviceLists([ownUserId]), new Map());
    await this.processOutgoingRequests();

    const newlySigned: string[] = [];
    const userDevices = await this.machine.getUserDevices(new UserId(this.userId));
    for (const device of userDevices.devices()) {
      if (device.deviceId.toString() === this.deviceId || device.isCrossSignedByOwner()) continue;
      const sigReq = await device.verify();
      await apiFetch('/keys/signatures/upload', this.sessionToken, { body: JSON.parse(sigReq.body) });
      newlySigned.push(device.deviceId.toString());
    }
    return newlySigned;
  }

  /** Encrypts and sends one to-device event to a specific peer device via the attached relay. Call ensureSessionWith first. Shared by every *encrypted* outgoing event kind below — messages, receipts, read receipts, typing. */
  private async encryptAndSend(peerUserId: string, peerDeviceId: string, eventType: string, content: unknown): Promise<void> {
    const device = await this.machine.getDevice(new UserId(peerUserId), new DeviceId(peerDeviceId));
    if (!device) {
      throw new Error(`No known device ${peerDeviceId} for ${peerUserId} — call ensureSessionWith first`);
    }
    const encryptedJson = await device.encryptToDeviceEvent(eventType, content);
    this.sender?.(peerDeviceId, 'm.room.encrypted', JSON.parse(encryptedJson));
  }

  /**
   * Encrypts and sends one to-device event to every current device of a
   * contact — not just whichever one happened to exist when the contact was
   * added. Establishes sessions first (ensureSessionWith already covers all
   * of a tracked user's devices, confirmed via grounding), then fans out via
   * encryptAndSend per device. Shared by sendMessage/sendTyping/
   * sendReadReceipt — the three per-conversation events where every device
   * of the contact should behave identically.
   */
  private async encryptAndSendToAllDevices(peerUserId: string, eventType: string, content: unknown): Promise<void> {
    await this.ensureSessionWith(peerUserId);
    const deviceIds = await this.getContactDevices(peerUserId);
    await Promise.all(deviceIds.map((deviceId) => this.encryptAndSend(peerUserId, deviceId, eventType, content)));
  }

  /**
   * Sends a to-device event with no Olm encryption at all — same pattern as
   * verification's plaintext m.key.verification.* events. Doesn't need
   * ensureSessionWith first (no device_keys lookup, no session). Used only
   * for contact accept/decline, which — like the request that precedes
   * them — carry nothing more sensitive than an already-server-visible
   * username; see sendContactRequest below for why the request itself
   * doesn't even go through this relay at all.
   */
  private sendPlain(peerDeviceId: string, eventType: string, content: unknown): void {
    this.sender?.(peerDeviceId, eventType, content);
  }

  /** Encrypts a plaintext message body and fans it out to every current device of the contact. Returns the client-generated message id (the same id in every copy), used to match up the delivery/read receipts later. */
  async sendMessage(peerUserId: string, plaintextBody: string): Promise<string> {
    const messageId = crypto.randomUUID();
    await this.encryptAndSendToAllDevices(peerUserId, 'm.cycove.message', { body: plaintextBody, id: messageId });
    return messageId;
  }

  /**
   * Sends a contact request via a plain authenticated HTTP call, not the
   * to-device relay — deliberately not Olm-encrypted. Rate-limiting the
   * actual abuse vector here (unsolicited requests) needs the server to be
   * able to see this is a contact-request event, which it can't do for
   * anything sent as opaque Olm ciphertext over the WS relay (that's the
   * whole point of E2EE) — see backend/src/routes/contacts.ts and
   * docs/crypto-integration-notes.md.
   */
  async sendContactRequest(peerUserId: string, peerDeviceId: string, myUsername: string | null): Promise<void> {
    await apiFetch('/contacts/request', this.sessionToken, {
      body: { recipient_user_id: peerUserId, recipient_device_id: peerDeviceId, username: myUsername },
    });
  }

  sendContactAccept(peerDeviceId: string): void {
    this.sendPlain(peerDeviceId, 'm.cycove.contact_accept', {});
  }

  sendContactDecline(peerDeviceId: string): void {
    this.sendPlain(peerDeviceId, 'm.cycove.contact_decline', {});
  }

  sendTyping(peerUserId: string, state: 'start' | 'stop'): Promise<void> {
    return this.encryptAndSendToAllDevices(peerUserId, 'm.cycove.typing', { state });
  }

  sendReadReceipt(peerUserId: string, messageId: string): Promise<void> {
    return this.encryptAndSendToAllDevices(peerUserId, 'm.cycove.read', { message_id: messageId });
  }

  /**
   * Pushes this device's local conversation history for one contact to a
   * specific sibling device of the SAME account — the actual mechanism
   * behind history sync (see docs/crypto-integration-notes.md). Reuses
   * 100% of existing crypto/relay infrastructure: it's just encryptAndSend
   * targeting the caller's own userId + a sibling deviceId, same as any
   * other to-device event. Called once per newly-discovered sibling, from
   * reconcileOwnDevices' return value — see ClientApp.tsx.
   */
  async sendHistorySync(siblingDeviceId: string, contactUserId: string, messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.ensureSessionWith(this.userId);
    const capped = messages.slice(-HISTORY_SYNC_MESSAGE_CAP);
    await this.encryptAndSend(this.userId, siblingDeviceId, 'm.cycove.history_sync', { contactUserId, messages: capped });
  }

  // ---- Usernames — see docs/crypto-integration-notes.md for the reversal from local-only labels ----

  async claimUsername(username: string): Promise<void> {
    await apiFetch('/users/username', this.sessionToken, { method: 'PUT', body: { username } });
  }

  async lookupUsername(username: string): Promise<{ userId: string; deviceId: string } | null> {
    try {
      const result = await apiFetch(`/users/by-username/${encodeURIComponent(username)}`, this.sessionToken, { method: 'GET' });
      return { userId: result.user_id, deviceId: result.device_id };
    } catch {
      return null; // not found, or a transient error — either way, no match to act on
    }
  }

  // ---- Encrypted account-data backup — see docs/crypto-integration-notes.md ----
  // Shared by contacts and cross-signing-key backups below — both are opaque
  // JSON blobs, distinguished only by dataType (backend/prisma/schema.prisma's
  // EncryptedBackup is keyed on [userId, dataType] for exactly this reason).

  /** No-op if there's no backup key (shouldn't happen for any session created after this feature shipped, but a defensive no-op beats a crash). */
  private async encryptAndUploadBackup(dataType: string, data: unknown): Promise<void> {
    if (!this.backupKey) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.backupKey, plaintext);
    await apiFetch(`/account-data/${dataType}`, this.sessionToken, {
      method: 'PUT',
      body: { ciphertext: arrayBufferToBase64(ciphertext), iv: arrayBufferToBase64(iv.buffer as ArrayBuffer) },
    });
  }

  /** Returns null if there's no backup key, no backup uploaded yet, or the fetch fails — callers fall back to whatever's already in local storage. */
  private async fetchAndDecryptBackup<T>(dataType: string): Promise<T | null> {
    if (!this.backupKey) return null;
    let response: { ciphertext: string; iv: string };
    try {
      response = await apiFetch(`/account-data/${dataType}`, this.sessionToken, { method: 'GET' });
    } catch {
      return null;
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(response.iv)) },
      this.backupKey,
      base64ToArrayBuffer(response.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }

  async encryptAndUploadContacts(contacts: unknown): Promise<void> {
    return this.encryptAndUploadBackup('contacts', contacts);
  }

  async fetchAndDecryptContacts<T>(): Promise<T | null> {
    return this.fetchAndDecryptBackup<T>('contacts');
  }

  // ---- Device linking — see linkDevice() above for the other side ----

  /** Only callable when already logged in. Single-use, expires server-side — see backend/src/routes/devices.ts. */
  async requestPairingCode(): Promise<{ pairingToken: string; expiresInSeconds: number }> {
    const result = await apiFetch('/devices/pairing-token', this.sessionToken, {});
    return { pairingToken: result.pairing_token, expiresInSeconds: result.expires_in };
  }

  /** Every device on this account, including this one — the caller compares ids to mark which. */
  async listDevices(): Promise<{ id: string; createdAt: string; lastSeenAt: string }[]> {
    const result = await apiFetch('/devices', this.sessionToken, { method: 'GET' });
    return result.devices;
  }

  /** Ends every live session for that device server-side, then removes it — see backend/src/routes/devices.ts. */
  async revokeDevice(deviceId: string): Promise<void> {
    await apiFetch(`/devices/${deviceId}`, this.sessionToken, { method: 'DELETE' });
  }

  /**
   * Feeds one incoming to-device event (from RelayConnection's onDeliver)
   * into the OlmMachine. Generic — handles encrypted messages, receipts,
   * contact requests, typing signals, and verification-protocol events the
   * same way; see docs/crypto-integration-notes.md for why they're unified.
   * A successfully decrypted chat message triggers an encrypted delivery
   * receipt straight back to the sender's device — same wire mechanism as
   * everything else, no new backend support needed.
   */
  async handleIncoming(
    senderUserId: string,
    senderDeviceId: string,
    eventType: string,
    content: unknown,
  ): Promise<IncomingResult> {
    const toDeviceEvents = JSON.stringify([{ sender: senderUserId, type: eventType, content }]);
    const processed = await this.machine.receiveSyncChanges(toDeviceEvents, new DeviceLists(), new Map());

    // Verification's next step (key/mac/done) often shows up here as a side
    // effect, not in `processed` — always check after receiving anything.
    await this.processOutgoingRequests();

    for (const event of processed) {
      if (event.constructor.name === 'DecryptedToDeviceEvent' && 'rawEvent' in event) {
        const raw = JSON.parse((event as { rawEvent: string }).rawEvent) as {
          type?: string;
          content?: {
            body?: string;
            id?: string;
            message_id?: string;
            username?: string;
            state?: string;
            contactUserId?: string;
            messages?: ChatMessage[];
          };
        };

        switch (raw.type) {
          case 'm.cycove.message': {
            if (!raw.content?.id || raw.content.body === undefined) break;
            const messageId = raw.content.id;
            await this.encryptAndSend(senderUserId, senderDeviceId, 'm.cycove.receipt', { message_id: messageId });
            return { kind: 'message', id: messageId, text: raw.content.body };
          }
          case 'm.cycove.receipt':
            if (raw.content?.message_id) return { kind: 'receipt', messageId: raw.content.message_id };
            break;
          case 'm.cycove.read':
            if (raw.content?.message_id) return { kind: 'read', messageId: raw.content.message_id };
            break;
          case 'm.cycove.typing':
            if (raw.content?.state === 'start' || raw.content?.state === 'stop') {
              return { kind: 'typing', state: raw.content.state };
            }
            break;
          case 'm.cycove.history_sync':
            if (raw.content?.contactUserId && Array.isArray(raw.content.messages)) {
              return { kind: 'history_sync', contactUserId: raw.content.contactUserId, messages: raw.content.messages };
            }
            break;
        }
      }
    }
    return { kind: 'none' }; // PlainTextToDeviceEvent (verification steps), UTDToDeviceEvent, etc — nothing to show as a message
  }

  // ---- Safety-number (SAS) verification — see docs/crypto-integration-notes.md ----

  /** Starts verifying a specific peer device. The peer sees this via getIncomingVerificationRequests. */
  async requestVerification(peerUserId: string, peerDeviceId: string): Promise<VerificationRequest> {
    const device = await this.machine.getDevice(new UserId(peerUserId), new DeviceId(peerDeviceId));
    if (!device) {
      throw new Error(`No known device ${peerDeviceId} for ${peerUserId} — call ensureSessionWith first`);
    }
    const [request, outgoing] = device.requestVerification();
    this.relayOutgoing(outgoing);
    return request;
  }

  /** Call after handleIncoming for a sender you might be mid-verification with, to discover newly-arrived requests/state. */
  async getIncomingVerificationRequests(peerUserId: string): Promise<VerificationRequest[]> {
    return this.machine.getVerificationRequests(new UserId(peerUserId));
  }

  acceptVerificationRequest(request: VerificationRequest): void {
    this.relayOutgoing(request.accept());
  }

  async startSas(request: VerificationRequest): Promise<Sas | undefined> {
    const result = await request.startSas();
    if (!result) return undefined;
    const [sas, outgoing] = result;
    this.relayOutgoing(outgoing);
    return sas;
  }

  /** Called on the side that receives the SAS start (not the initiator, who already has it from startSas). */
  acceptSas(sas: Sas): void {
    this.relayOutgoing(sas.accept());
  }

  /**
   * Call once the user confirms the displayed emoji actually match on both
   * sides. Beyond marking this one device verified, also upgrades trust to
   * the peer's whole cross-signed identity (any of their other current or
   * future devices) when the peer is a different user — confirmed via
   * grounding that sas.confirm() never does this on its own (see
   * docs/crypto-integration-notes.md's cross-signing section).
   */
  async confirmSas(sas: Sas): Promise<void> {
    const outgoing = await sas.confirm();
    for (const out of outgoing) this.relayOutgoing(out);

    const peerUserId = sas.otherUserId.toString();
    if (peerUserId === this.userId) return; // our own other device, not a contact — nothing to cross-sign

    try {
      const identity = await this.machine.getIdentity(new UserId(peerUserId));
      if (identity) {
        const verifyReq = await identity.verify();
        await apiFetch('/keys/signatures/upload', this.sessionToken, { body: JSON.parse(verifyReq.body) });
      }
    } catch {
      // Missing our own private user-signing key (this device never
      // bootstrapped cross-signing) — the SAS verification itself already
      // succeeded above; this is a trust-scope upgrade, not required for it.
    }
  }

  /** Call if the user says the emoji *don't* match — this is the actual point of doing this at all. */
  cancelSas(sas: Sas): void {
    this.relayOutgoing(sas.cancelWithCode('m.mismatched_sas'));
  }

  isPeerDeviceVerified(peerUserId: string, peerDeviceId: string): Promise<boolean> {
    return this.machine
      .getDevice(new UserId(peerUserId), new DeviceId(peerDeviceId))
      .then((device) => device?.isVerified() ?? false);
  }
}
