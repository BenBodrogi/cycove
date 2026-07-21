// Local contact list — sessionStorage, not localStorage, same reasoning as
// crypto.ts's SESSION_STORAGE_KEY: two accounts under test live in two tabs
// of the same browser, and localStorage is shared per-origin across tabs
// while sessionStorage is per-tab. No passphrase protection yet — same open
// gap as the session/key material in crypto.ts. Conversation history is
// IndexedDB instead — see loadConversations/saveConversations below.

export interface Contact {
  userId: string;
  // Seed device(s) from the share code/contact-request that established this
  // contact — an anchor for verification/accept/decline (crypto.ts's
  // requestVerification/sendContactAccept/sendContactDecline still target one
  // specific device, deviceIds[0]), not the live device list. Messages,
  // typing, and read receipts fan out to every current device of the contact
  // via a fresh query at send time (crypto.ts's getContactDevices), not by
  // reading this field — so it doesn't need to be kept in sync as the
  // contact links more devices. See docs/crypto-integration-notes.md for why
  // a single pinned device silently dropped messages to a contact's others.
  deviceIds: string[];
  nickname: string | null; // what *I* call them
  theirUsername: string | null; // the label *they* embedded in their share code, if any — a suggestion, not authoritative
  avatarDataUrl: string | null; // local-only, never transmitted — see fileToAvatarDataUrl
  addedAt: number;
  status: 'connected' | 'pending-outgoing' | 'pending-incoming';
}

export interface ChatMessage {
  id: string;
  direction: 'sent' | 'received';
  body: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'read';
}

const CONTACTS_KEY = 'cycove_contacts';
const OWN_USERNAME_KEY = 'cycove_own_username';

export function loadContacts(): Contact[] {
  const raw = sessionStorage.getItem(CONTACTS_KEY);
  return raw ? (JSON.parse(raw) as Contact[]) : [];
}

export function saveContacts(contacts: Contact[]): void {
  sessionStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

// Conversations live in IndexedDB, not sessionStorage — deliberately, and
// unlike everything else in this file. History-sync (crypto.ts's
// sendHistorySync/reconcileOwnDevices) pushes an already-established
// device's local history to a newly linked sibling; that only works if the
// history is still around to push, and sessionStorage is wiped on tab
// close. Keyed per-deviceId (`cycove-conversations-<deviceId>`), same
// naming convention as the OlmMachine's own store (`cycove-<deviceId>`) —
// preserves the same practical per-device isolation this project's two-tab
// testing has relied on (each registered device already gets a distinct
// deviceId), it just stops losing history on tab close as a side effect.
const CONVERSATIONS_STORE_NAME = 'conversations';

function conversationsDbName(deviceId: string): string {
  return `cycove-conversations-${deviceId}`;
}

function openConversationsDb(deviceId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(conversationsDbName(deviceId), 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(CONVERSATIONS_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadConversations(deviceId: string): Promise<Record<string, ChatMessage[]>> {
  const db = await openConversationsDb(deviceId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE_NAME, 'readonly');
    const store = tx.objectStore(CONVERSATIONS_STORE_NAME);
    const result: Record<string, ChatMessage[]> = {};
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        result[cursor.key as string] = cursor.value as ChatMessage[];
        cursor.continue();
      } else {
        db.close();
        resolve(result);
      }
    };
    cursorReq.onerror = () => {
      db.close();
      reject(cursorReq.error);
    };
  });
}

// Whole-object-in, whole-object-out — same shape as every other save in this
// file, just backed by IndexedDB instead of sessionStorage. Clears and
// rewrites every contact's conversation each call; fine at this scale, and
// keeps the persistence model identical to before rather than switching to
// incremental per-message writes as part of this change too.
export async function saveConversations(deviceId: string, conversations: Record<string, ChatMessage[]>): Promise<void> {
  const db = await openConversationsDb(deviceId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CONVERSATIONS_STORE_NAME);
    store.clear();
    for (const [contactUserId, messages] of Object.entries(conversations)) {
      store.put(messages, contactUserId);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export function loadOwnUsername(): string | null {
  return sessionStorage.getItem(OWN_USERNAME_KEY);
}

export function saveOwnUsername(username: string | null): void {
  if (username) sessionStorage.setItem(OWN_USERNAME_KEY, username);
  else sessionStorage.removeItem(OWN_USERNAME_KEY);
}

// Share codes — a copy-pasteable stand-in for QR-code contact adding (wireframe
// screen 02, not built yet — no Android client to pair with). base64(JSON) of
// {userId, deviceId, username}, nothing sensitive (all already either public
// identifiers or a self-chosen local label, never a directory lookup key).

function base64EncodeUtf8(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function base64DecodeUtf8(b64: string): string {
  return decodeURIComponent(escape(atob(b64)));
}

export function encodeShareCode(userId: string, deviceId: string, username: string | null): string {
  return base64EncodeUtf8(JSON.stringify({ u: userId, d: deviceId, n: username ?? undefined }));
}

export function decodeShareCode(code: string): { userId: string; deviceId: string; username: string | null } | null {
  try {
    const parsed = JSON.parse(base64DecodeUtf8(code.trim())) as { u?: string; d?: string; n?: string };
    if (!parsed.u || !parsed.d) return null;
    return { userId: parsed.u, deviceId: parsed.d, username: parsed.n ?? null };
  } catch {
    return null;
  }
}

// Pairing codes — same pattern as share codes above, for linking a new
// device to an existing account (web/src/lib/crypto.ts's requestPairingCode/
// linkDevice). Bundles the userId alongside the server-issued pairing_token
// so the new device knows which account to attach to without the backend
// needing to change — /devices/pairing-token only ever returns the token
// itself, this wraps it client-side the same way a share code wraps
// {userId, deviceId, username}.
export function encodePairingCode(pairingToken: string, userId: string): string {
  return base64EncodeUtf8(JSON.stringify({ t: pairingToken, u: userId }));
}

export function decodePairingCode(code: string): { pairingToken: string; userId: string } | null {
  try {
    const parsed = JSON.parse(base64DecodeUtf8(code.trim())) as { t?: string; u?: string };
    if (!parsed.t || !parsed.u) return null;
    return { pairingToken: parsed.t, userId: parsed.u };
  } catch {
    return null;
  }
}

// Avatars — local-only (never transmitted, see Contact.avatarDataUrl). Resized
// client-side before storing: sessionStorage's per-origin quota now has to fit
// contacts + full message history + however many avatars, so each one is
// downscaled to a small fixed square rather than stored at original size.
export function fileToAvatarDataUrl(file: File, size = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      // Crop to a centered square before scaling down, so non-square source
      // images don't get squashed.
      const cropSize = Math.min(img.width, img.height);
      const sx = (img.width - cropSize) / 2;
      const sy = (img.height - cropSize) / 2;
      ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image'));
    };
    img.src = objectUrl;
  });
}
