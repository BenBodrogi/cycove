'use client';

import { useEffect, useRef, useState } from 'react';
import { CyCoveCrypto, clearSession } from '../src/lib/crypto';
import { RelayConnection, type DeliveredToDeviceEvent } from '../src/lib/ws';
import {
  type Contact,
  type ChatMessage,
  loadContacts,
  saveContacts,
  loadConversations,
  saveConversations,
  loadOwnUsername,
  saveOwnUsername,
  loadReadReceiptsEnabled,
  saveReadReceiptsEnabled,
  encodeShareCode,
  encodePairingCode,
  decodePairingCode,
} from '../src/lib/store';
import { Sas, type VerificationRequest, type Emoji } from '@matrix-org/matrix-sdk-crypto-wasm';
import Sidebar from './components/Sidebar';
import Conversation from './components/Conversation';
import AddContactPanel from './components/AddContactPanel';
import EditContactPanel from './components/EditContactPanel';
import LinkDevicePanel from './components/LinkDevicePanel';
import QrScanner from './components/QrScanner';
import DevicesPanel from './components/DevicesPanel';
import ForwardMessagePanel from './components/ForwardMessagePanel';

// The real chat UI (wireframe screen 03, docs/wireframes.md) — multi-contact,
// with delivery/read receipts, typing indicators, per-contact avatars, a
// request/accept contact flow alongside the original direct-connect flow, and
// mandatory verification before messaging. Contacts persist in sessionStorage
// (per-tab); conversation history persists in IndexedDB, keyed per-deviceId
// (survives tab close — see src/lib/store.ts and docs/crypto-integration-notes.md
// for why history sync depends on that). Messages/typing/read receipts fan
// out to every current device of a contact, not just one — see
// crypto.ts's getContactDevices. Out of scope for this pass: the full
// recovery-key reveal flow, free-tier composer limits, a searchable
// username directory (usernames are local labels embedded in share codes
// only — see docs/crypto-integration-notes.md).

export type VerifPhase =
  | 'idle'
  | 'outgoing-pending' // we requested, waiting for peer to accept
  | 'incoming-pending' // peer requested, waiting for us to accept
  | 'sas-comparing'
  | 'sas-confirmed-self' // we confirmed, waiting for peer's mac/done
  | 'verified'
  | 'cancelled';

export default function ClientApp() {
  const [session, setSession] = useState<CyCoveCrypto | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'register' | 'login' | 'link'>('register');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginRecoveryKey, setLoginRecoveryKey] = useState('');
  const [linkPairingCode, setLinkPairingCode] = useState('');
  const [linkRecoveryKey, setLinkRecoveryKey] = useState('');
  const [showQrScanner, setShowQrScanner] = useState(false);

  // Device linking — see requestPairingCode/linkDevice in crypto.ts.
  const [showLinkDevicePanel, setShowLinkDevicePanel] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null);

  // "Your devices" list + revoke.
  const [showDevicesPanel, setShowDevicesPanel] = useState(false);
  const [devices, setDevices] = useState<{ id: string; createdAt: string; lastSeenAt: string }[]>([]);

  const [contacts, setContacts] = useState<Contact[]>(() => loadContacts());
  // Loaded async once a session/deviceId exists — see the restore effect and
  // handleRegister/handleLogin/handleLinkDevice below. IndexedDB, not
  // sessionStorage, so it survives tab close — see src/lib/store.ts.
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({});
  const [ownUsername, setOwnUsername] = useState<string>(() => loadOwnUsername() ?? '');
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState<boolean>(() => loadReadReceiptsEnabled());
  const [activeContactUserId, setActiveContactUserId] = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [typingContacts, setTypingContacts] = useState<Record<string, boolean>>({});
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);

  const [verifPhase, setVerifPhase] = useState<Record<string, VerifPhase>>({});
  const [verifEmoji, setVerifEmoji] = useState<Record<string, Emoji[] | null>>({});
  const verifRequestRefs = useRef(new Map<string, VerificationRequest>());
  const verifSasRefs = useRef(new Map<string, Sas>());
  // Whether *we* called requestVerification for this contact (vs. discovering
  // an incoming one) — only the non-initiator auto-accepts the SAS method. A
  // ref map, not state: handleIncomingEvent is captured once by the WS
  // connection's useEffect at mount, so reading component state there would
  // see a permanently stale value.
  const isSasInitiatorRefs = useRef(new Map<string, boolean>());

  // Which received-message ids we've already sent a read receipt for, per
  // contact — avoids resending on every re-render of the tracking effect.
  const readSentRef = useRef(new Map<string, Set<string>>());
  // Safety-net timers that auto-clear a "typing" flag if a stop event is lost.
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const connectionRef = useRef<RelayConnection | null>(null);
  const sessionRef = useRef<CyCoveCrypto | null>(null);
  // Mirrors conversations state for handlers that need the latest value
  // without a stale closure (same reason sessionRef exists) — used by
  // reconcileAndSyncHistory, which runs from several places including a
  // polling effect and callbacks registered once at mount.
  const conversationsRef = useRef<Record<string, ChatMessage[]>>({});

  /**
   * Updates conversationsRef.current synchronously (not via a setState
   * updater callback, which can't be read back in the same tick) and awaits
   * the IndexedDB write before returning. A real race was found
   * live-testing: a fire-and-forget save (the useEffect below) racing a
   * near-immediate reload lost a just-received message and, worse, the
   * history this whole feature exists to sync. Used by both
   * handleIncomingEvent (awaited before acking — a reload/crash mid-write
   * then leaves the message in the server's queue, deleted only on ack, see
   * backend/src/lib/relay.ts — for redelivery next reconnect, instead of
   * silently dropping it) and handleSend, for the same guarantee on our own
   * outgoing messages.
   */
  async function applyConversationsUpdate(
    session_: CyCoveCrypto,
    updater: (prev: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>,
  ) {
    const updated = updater(conversationsRef.current);
    conversationsRef.current = updated;
    setConversations(updated);
    await saveConversations(session_.deviceId, updated);
  }

  useEffect(() => {
    void (async () => {
      const restored = await CyCoveCrypto.restore();
      if (restored) {
        setSession(restored);
        sessionRef.current = restored;
        setStatus('Restored existing session (this tab).');
        // Server backup wins on restore — the only realistic case where it'd
        // disagree with what's already in sessionStorage today is local
        // being empty (a genuinely fresh tab/device), so this is safe.
        const backedUp = await restored.fetchAndDecryptContacts<Contact[]>();
        if (backedUp) setContacts(backedUp);
        const loadedConversations = await loadConversations(restored.deviceId);
        setConversations(loadedConversations);
        // Defensive — no-ops once already bootstrapped. Catches accounts
        // created before this feature shipped, and picks up any sibling
        // devices linked since this tab was last open.
        await restored.bootstrapCrossSigningIfNeeded();
        // Pass the just-loaded value directly rather than reading
        // conversationsRef — the ref only updates via a useEffect reacting
        // to state, which hasn't run yet this tick.
        void reconcileAndSyncHistory(restored, loadedConversations);
      } else {
        setStatus('No session yet in this tab — click Register.');
      }
    })();
  }, []);

  useEffect(() => {
    saveContacts(contacts);
    if (session) void session.encryptAndUploadContacts(contacts);
  }, [contacts, session]);

  // Just keeps the ref in sync for reads (e.g. reconcileAndSyncHistory's
  // polling-effect/handleShowDevices call sites) — actual persistence is
  // handled synchronously by applyConversationsUpdate at the point of
  // mutation, not decoupled into this effect (that decoupling was the
  // fire-and-forget race found live-testing — see applyConversationsUpdate's
  // comment above).
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    saveOwnUsername(ownUsername || null);
  }, [ownUsername]);

  useEffect(() => {
    saveReadReceiptsEnabled(readReceiptsEnabled);
  }, [readReceiptsEnabled]);

  useEffect(() => {
    if (activeContactUserId) return;
    const selectable = contacts.find((c) => c.status !== 'pending-incoming');
    if (selectable) setActiveContactUserId(selectable.userId);
  }, [contacts, activeContactUserId]);

  // Re-establish Olm sessions and re-derive verified status for contacts
  // restored from sessionStorage — device.isVerified() reflects the crypto
  // library's own persistent IndexedDB store, not React state, so this is
  // the correct source of truth after a reload, not something we persist
  // ourselves. Only meaningful for already-connected contacts.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      for (const c of contacts) {
        if (c.status !== 'connected') continue;
        await session.ensureSessionWith(c.userId);
        const verified = await session.isPeerDeviceVerified(c.userId, c.deviceIds[0]!);
        if (!cancelled && verified) {
          setVerifPhase((prev) => (prev[c.userId] ? prev : { ...prev, [c.userId]: 'verified' }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, contacts]);

  // Sends a read receipt for any not-yet-acknowledged received message in
  // whichever conversation is currently open — unless the user has opted out
  // globally (readReceiptsEnabled), in which case we still track locally
  // that these were "seen" (via alreadySent, so nothing resends if the
  // setting is flipped back on mid-conversation) without ever transmitting
  // the m.cycove.read event itself.
  useEffect(() => {
    if (!activeContactUserId || !session) return;
    const contact = contacts.find((c) => c.userId === activeContactUserId);
    if (!contact || contact.status !== 'connected') return;
    const msgs = conversations[activeContactUserId] ?? [];
    const alreadySent = readSentRef.current.get(activeContactUserId) ?? new Set<string>();
    for (const m of msgs) {
      if (m.direction === 'received' && !alreadySent.has(m.id)) {
        alreadySent.add(m.id);
        if (readReceiptsEnabled) void session.sendReadReceipt(contact.userId, m.id);
      }
    }
    readSentRef.current.set(activeContactUserId, alreadySent);
  }, [activeContactUserId, conversations, contacts, session, readReceiptsEnabled]);

  function refreshVerifState(contactUserId: string) {
    const sas = verifSasRefs.current.get(contactUserId);
    const request = verifRequestRefs.current.get(contactUserId);
    if (sas) {
      if (sas.isDone()) {
        setVerifPhase((prev) => ({ ...prev, [contactUserId]: 'verified' }));
        return;
      }
      if (sas.canBePresented()) {
        setVerifEmoji((prev) => ({ ...prev, [contactUserId]: sas.emoji() ?? null }));
        setVerifPhase((prev) => ({
          ...prev,
          [contactUserId]: prev[contactUserId] === 'sas-confirmed-self' ? prev[contactUserId] : 'sas-comparing',
        }));
        return;
      }
    }
    if (request?.isCancelled()) {
      setVerifPhase((prev) => ({ ...prev, [contactUserId]: 'cancelled' }));
    }
  }

  async function handleVerificationEvent(session_: CyCoveCrypto, contactUserId: string) {
    if (!verifRequestRefs.current.has(contactUserId)) {
      const incoming = await session_.getIncomingVerificationRequests(contactUserId);
      const fresh = incoming.find((r) => !r.isCancelled() && !r.isDone());
      if (fresh) {
        verifRequestRefs.current.set(contactUserId, fresh);
        fresh.registerChangesCallback(async () => refreshVerifState(contactUserId));
        setVerifPhase((prev) => ({ ...prev, [contactUserId]: 'incoming-pending' }));
      }
    } else {
      const request = verifRequestRefs.current.get(contactUserId)!;
      const verification = request.getVerification();
      // getVerification() can also return a Qr — this app only speaks SAS.
      // instanceof, not a .constructor.name string check — the latter broke
      // in the production build once minification renamed the wasm-bindgen
      // classes (see crypto.ts's processOutgoingRequests for the full story).
      const existingSas = verification instanceof Sas ? verification : undefined;
      if (existingSas && !verifSasRefs.current.has(contactUserId)) {
        verifSasRefs.current.set(contactUserId, existingSas);
        existingSas.registerChangesCallback(async () => refreshVerifState(contactUserId));
        // Acceptor side: auto-accept the SAS *method* (not the emoji match —
        // that's the actual human decision, still to come).
        if (!isSasInitiatorRefs.current.get(contactUserId)) {
          session_.acceptSas(existingSas);
        }
      }
    }
    refreshVerifState(contactUserId);
  }

  function setContactTyping(contactUserId: string, isTyping: boolean, autoTimeoutMs?: number) {
    const existingTimer = typingTimersRef.current.get(contactUserId);
    if (existingTimer) clearTimeout(existingTimer);
    typingTimersRef.current.delete(contactUserId);
    setTypingContacts((prev) => ({ ...prev, [contactUserId]: isTyping }));
    if (isTyping && autoTimeoutMs) {
      const timer = setTimeout(() => {
        setTypingContacts((prev) => ({ ...prev, [contactUserId]: false }));
      }, autoTimeoutMs);
      typingTimersRef.current.set(contactUserId, timer);
    }
  }

  // Contact request/accept/decline never reach the OlmMachine at all — see
  // crypto.ts's sendContactRequest/sendPlain for why (the request specifically
  // needs to be server-visible for rate-limiting to work; accept/decline stay
  // plain alongside it rather than being asymmetrically encrypted).
  async function handlePlainContactEvent(
    session_: CyCoveCrypto,
    senderUserId: string,
    senderDeviceId: string,
    eventType: string,
    content: unknown,
  ) {
    if (eventType === 'm.cycove.contact_request') {
      const username = (content as { username?: string | null } | null)?.username ?? null;
      setContacts((prev) => {
        if (prev.some((c) => c.userId === senderUserId)) return prev; // already known — ignore a duplicate/late request
        return [
          ...prev,
          {
            userId: senderUserId,
            deviceIds: [senderDeviceId],
            nickname: null,
            theirUsername: username,
            avatarDataUrl: null,
            addedAt: Date.now(),
            status: 'pending-incoming',
          },
        ];
      });
    } else if (eventType === 'm.cycove.contact_accept') {
      // The requester's side: sendContactRequest never called
      // ensureSessionWith (it's a plain HTTP call, no Olm session needed to
      // send it) — establish it now, before verification/messaging needs it.
      await session_.ensureSessionWith(senderUserId);
      setContacts((prev) => prev.map((c) => (c.userId === senderUserId ? { ...c, status: 'connected' as const } : c)));
    } else if (eventType === 'm.cycove.contact_decline') {
      setContacts((prev) => prev.filter((c) => c.userId !== senderUserId));
    }
  }

  async function handleIncomingEvent(msg: DeliveredToDeviceEvent) {
    const session_ = sessionRef.current;
    const connection = connectionRef.current;
    if (!session_) return;

    const senderUserId = msg.sender_user_id;
    const senderDeviceId = msg.sender_device_id;

    if (
      msg.event_type === 'm.cycove.contact_request' ||
      msg.event_type === 'm.cycove.contact_accept' ||
      msg.event_type === 'm.cycove.contact_decline'
    ) {
      await handlePlainContactEvent(session_, senderUserId, senderDeviceId, msg.event_type, msg.content);
      connection?.ack(msg.message_id);
      return;
    }

    const result = await session_.handleIncoming(senderUserId, senderDeviceId, msg.event_type, msg.content);

    switch (result.kind) {
      case 'message': {
        const newMsg: ChatMessage = {
          id: result.id,
          direction: 'received',
          body: result.text,
          timestamp: Date.now(),
          status: 'delivered',
          replyToId: result.replyToId,
        };
        await applyConversationsUpdate(session_, (prev) => ({ ...prev, [senderUserId]: [...(prev[senderUserId] ?? []), newMsg] }));
        break;
      }
      case 'message_echo': {
        // A message WE sent, arriving from one of our own other devices —
        // displays as 'sent' here too. Dedup defensively: encryptAndSend
        // already excludes this.deviceId from the self-fanout targets, so
        // the sending device itself should never see its own echo, but this
        // guard costs nothing and matches history_sync's own dedup caution.
        const newMsg: ChatMessage = {
          id: result.id,
          direction: 'sent',
          body: result.text,
          timestamp: Date.now(),
          status: 'sent',
          replyToId: result.replyToId,
        };
        await applyConversationsUpdate(session_, (prev) => {
          const existing = prev[result.contactUserId] ?? [];
          if (existing.some((m) => m.id === result.id)) return prev;
          return { ...prev, [result.contactUserId]: [...existing, newMsg] };
        });
        break;
      }
      case 'reaction': {
        const field = result.fromSelf ? 'mine' : 'theirs';
        await applyConversationsUpdate(session_, (prev) => {
          const existing = prev[result.contactUserId];
          if (!existing) return prev;
          return {
            ...prev,
            [result.contactUserId]: existing.map((m) => {
              if (m.id !== result.messageId) return m;
              const reactions = { ...m.reactions };
              if (result.emoji) reactions[field] = result.emoji;
              else delete reactions[field];
              return { ...m, reactions };
            }),
          };
        });
        break;
      }
      case 'delete': {
        await applyConversationsUpdate(session_, (prev) => {
          const existing = prev[result.contactUserId];
          if (!existing) return prev;
          return {
            ...prev,
            [result.contactUserId]: existing.map((m) => (m.id === result.messageId ? { ...m, deleted: true, body: '' } : m)),
          };
        });
        break;
      }
      case 'receipt':
        await applyConversationsUpdate(session_, (prev) => {
          const existing = prev[senderUserId];
          if (!existing) return prev;
          return {
            ...prev,
            [senderUserId]: existing.map((m) => (m.id === result.messageId && m.status === 'sent' ? { ...m, status: 'delivered' as const } : m)),
          };
        });
        break;
      case 'read':
        await applyConversationsUpdate(session_, (prev) => {
          const existing = prev[senderUserId];
          if (!existing) return prev;
          return { ...prev, [senderUserId]: existing.map((m) => (m.id === result.messageId ? { ...m, status: 'read' as const } : m)) };
        });
        break;
      case 'typing':
        setContactTyping(senderUserId, result.state === 'start', result.state === 'start' ? 6000 : undefined);
        break;
      case 'history_sync': {
        // From a sibling device of our OWN account (see crypto.ts's
        // sendHistorySync/reconcileOwnDevices), not from senderUserId's
        // contact — result.contactUserId names whose conversation this is.
        await applyConversationsUpdate(session_, (prev) => {
          const existing = prev[result.contactUserId] ?? [];
          const existingIds = new Set(existing.map((m) => m.id));
          const merged = [...existing, ...result.messages.filter((m) => !existingIds.has(m.id))];
          merged.sort((a, b) => a.timestamp - b.timestamp);
          return { ...prev, [result.contactUserId]: merged };
        });
        break;
      }
    }

    if (msg.event_type.startsWith('m.key.verification.')) {
      await handleVerificationEvent(session_, senderUserId);
    }

    connection?.ack(msg.message_id);
  }

  useEffect(() => {
    if (!session) return;

    const connection = new RelayConnection(session.sessionToken, (msg) => void handleIncomingEvent(msg));
    session.attachSender((deviceId, eventType, content) => connection.sendToDevice(deviceId, eventType, content));

    connectionRef.current = connection;
    void connection.ready().then(() => setStatus('Connected and authenticated.'));

    return () => connection.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /**
   * Signs any newly-discovered sibling device (reconcileOwnDevices) and, for
   * each one, pushes this device's local history to it exactly once — the
   * actual mechanism behind history sync, see docs/crypto-integration-notes.md.
   * Takes conversations explicitly rather than reading conversationsRef,
   * since callers right after a fresh load can't rely on the ref (it only
   * updates via a useEffect reacting to state, which hasn't run yet in the
   * same tick) — see the restore effect above for that exact race.
   */
  async function reconcileAndSyncHistory(session_: CyCoveCrypto, currentConversations: Record<string, ChatMessage[]>) {
    const newlySigned = await session_.reconcileOwnDevices();
    for (const deviceId of newlySigned) {
      for (const [contactUserId, messages] of Object.entries(currentConversations)) {
        void session_.sendHistorySync(deviceId, contactUserId, messages);
      }
    }
  }

  async function handleRegister() {
    setStatus('Registering…');
    setAuthError(null);
    // Simplified for this test: a random recovery key, no confirm-you-saved-it
    // flow yet — see docs/ux-flows.md for the real design.
    const key = crypto.randomUUID() + '-' + crypto.randomUUID();
    const newSession = await CyCoveCrypto.register(key);
    await newSession.bootstrapCrossSigningIfNeeded();
    setConversations(await loadConversations(newSession.deviceId));
    setRecoveryKey(key);
    setSession(newSession);
    sessionRef.current = newSession;
    setStatus('Registered.');
  }

  async function handleLogin(username: string, recoveryKeyInput: string) {
    setStatus('Logging in…');
    setAuthError(null);
    try {
      const newSession = await CyCoveCrypto.login(username, recoveryKeyInput);
      // Must happen before setSession: the contacts-upload effect fires the
      // instant session becomes non-null, using whatever's already in
      // `contacts` (still empty from a prior logout) — restoring first means
      // that effect either sees the real data already, or harmlessly
      // re-uploads it, instead of clobbering the server backup with [].
      const backedUp = await newSession.fetchAndDecryptContacts<Contact[]>();
      if (backedUp) setContacts(backedUp);
      const loadedConversations = await loadConversations(newSession.deviceId);
      setConversations(loadedConversations);
      // Defensive bootstrap (accounts predating this feature) + pick up any
      // sibling devices linked since this device was last logged in.
      await newSession.bootstrapCrossSigningIfNeeded();
      await reconcileAndSyncHistory(newSession, loadedConversations);
      setSession(newSession);
      sessionRef.current = newSession;
      setStatus('Logged in.');
    } catch (err) {
      setStatus('');
      // A distinguishable message from CyCoveCrypto.login — this browser
      // doesn't have the account's real keys locally. Surfaced specially so
      // the UI can point at linking instead of just showing a generic error.
      setAuthError(err instanceof Error && err.message === 'KEYS_NOT_ON_THIS_DEVICE' ? 'KEYS_NOT_ON_THIS_DEVICE' : err instanceof Error ? err.message : 'Login failed.');
    }
  }

  async function handleLinkDevice(pairingCodeInput: string, recoveryKeyInput: string) {
    setStatus('Linking device…');
    setAuthError(null);
    const decoded = decodePairingCode(pairingCodeInput);
    if (!decoded) {
      setStatus('');
      setAuthError("That pairing code doesn't look valid.");
      return;
    }
    try {
      const newSession = await CyCoveCrypto.linkDevice(decoded.userId, decoded.pairingToken, recoveryKeyInput.trim() || undefined);
      // Same ordering reason as handleLogin — no-ops (returns null) if no
      // recovery key was given, since there's no backup key to decrypt with.
      const backedUp = await newSession.fetchAndDecryptContacts<Contact[]>();
      if (backedUp) setContacts(backedUp);
      const loadedConversations = await loadConversations(newSession.deviceId);
      setConversations(loadedConversations);
      // Also no-ops without a recovery key — this device then stays
      // unable to sign anything itself until an already-cross-signed
      // sibling reconciles it from its own side (see crypto.ts).
      await newSession.restoreCrossSigningKeys();
      await reconcileAndSyncHistory(newSession, loadedConversations);
      setSession(newSession);
      sessionRef.current = newSession;
      setStatus('Device linked.');
    } catch (err) {
      setStatus('');
      setAuthError(err instanceof Error ? err.message : 'Could not link this device.');
    }
  }

  async function handleRequestPairingCode() {
    const session_ = sessionRef.current;
    if (!session_) return;
    const { pairingToken, expiresInSeconds } = await session_.requestPairingCode();
    setPairingCode(encodePairingCode(pairingToken, session_.userId));
    setPairingExpiresAt(Date.now() + expiresInSeconds * 1000);
    setShowLinkDevicePanel(true);
  }

  // Signing a newly linked sibling device — and pushing this device's local
  // history to it — only happens from an *already*-cross-signed device's
  // side (see crypto.ts's reconcileOwnDevices/sendHistorySync). Nothing
  // pushes a "a new device just linked" notification, so poll while this
  // device is actively watching for one to appear (i.e. its own "Link a
  // device" panel is open) and reconcile the moment it does, rather than
  // leaving it unsigned/without history until this device's next login/restore.
  useEffect(() => {
    if (!showLinkDevicePanel) return;
    const session_ = sessionRef.current;
    if (!session_) return;

    let cancelled = false;
    let knownCount: number | null = null;

    const poll = async () => {
      const list = await session_.listDevices();
      if (cancelled) return;
      if (knownCount === null) {
        knownCount = list.length;
      } else if (list.length > knownCount) {
        await reconcileAndSyncHistory(session_, conversationsRef.current);
        knownCount = list.length;
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showLinkDevicePanel]);

  async function handleShowDevices() {
    const session_ = sessionRef.current;
    if (!session_) return;
    // Also a natural moment to catch up on signing any sibling devices
    // linked since this device last reconciled, and push history to any
    // that are newly discovered here.
    await reconcileAndSyncHistory(session_, conversationsRef.current);
    setDevices(await session_.listDevices());
    setShowDevicesPanel(true);
  }

  async function handleRevokeDevice(deviceId: string) {
    const session_ = sessionRef.current;
    if (!session_) return;
    await session_.revokeDevice(deviceId);
    if (deviceId === session_.deviceId) {
      // The session that was just revoked is this tab's own — its token is
      // already dead server-side, so finish the job locally too.
      handleLogout();
      return;
    }
    setDevices(await session_.listDevices());
  }

  function handleLogout() {
    clearSession();
    for (const timer of typingTimersRef.current.values()) clearTimeout(timer);
    typingTimersRef.current.clear();
    verifRequestRefs.current.clear();
    verifSasRefs.current.clear();
    isSasInitiatorRefs.current.clear();
    readSentRef.current.clear();

    saveContacts([]);
    // Deliberately NOT clearing IndexedDB conversation history here — it's
    // keyed per-deviceId (see store.ts), same as the OlmMachine's own crypto
    // store, and never wiped on logout either. Logging out just clears this
    // tab's active session/display; the history stays on disk so this device
    // can still serve as a history-sync source for a sibling later, and so
    // logging back in on the SAME device (same deviceId) gets it back.
    saveOwnUsername('');

    setSession(null);
    sessionRef.current = null;
    setRecoveryKey(null);
    setAuthMode('register');
    setAuthError(null);
    setContacts([]);
    setConversations({});
    setOwnUsername('');
    setActiveContactUserId(null);
    setShowAddContact(false);
    setEditingContact(null);
    setTypingContacts({});
    setVerifPhase({});
    setVerifEmoji({});
    setShowLinkDevicePanel(false);
    setPairingCode(null);
    setPairingExpiresAt(null);
    setShowDevicesPanel(false);
    setDevices([]);
    setStatus('Logged out.');
  }

  async function handleSendRequest(peer: { userId: string; deviceId: string; username: string | null }, nickname: string): Promise<void> {
    const session_ = sessionRef.current;
    if (!session_) throw new Error('No active session.');
    if (peer.userId === session_.userId) throw new Error("That's you.");
    if (contacts.some((c) => c.userId === peer.userId)) throw new Error('This contact is already in your list.');

    // No ensureSessionWith here — sendContactRequest is a plain HTTP call,
    // no Olm session needed yet. One gets established on contact_accept
    // (see handlePlainContactEvent) before anything needs to encrypt to them.
    await session_.sendContactRequest(peer.userId, peer.deviceId, ownUsername || null);
    const contact: Contact = {
      userId: peer.userId,
      deviceIds: [peer.deviceId],
      nickname: nickname || null,
      theirUsername: peer.username,
      avatarDataUrl: null,
      addedAt: Date.now(),
      status: 'pending-outgoing',
    };
    setContacts((prev) => [...prev, contact]);
    setActiveContactUserId(contact.userId);
    setShowAddContact(false);
  }

  async function handleClaimUsername(username: string): Promise<void> {
    const session_ = sessionRef.current;
    if (!session_) throw new Error('No active session.');
    await session_.claimUsername(username);
    setOwnUsername(username);
  }

  async function handleLookupUsername(username: string): Promise<{ userId: string; deviceId: string } | null> {
    const session_ = sessionRef.current;
    if (!session_) return null;
    return session_.lookupUsername(username);
  }

  async function handleAcceptRequest(contactUserId: string): Promise<void> {
    const session_ = sessionRef.current;
    const contact = contacts.find((c) => c.userId === contactUserId);
    if (!session_ || !contact) return;
    await session_.ensureSessionWith(contactUserId);
    session_.sendContactAccept(contact.deviceIds[0]!);
    setContacts((prev) => prev.map((c) => (c.userId === contactUserId ? { ...c, status: 'connected' as const } : c)));
  }

  function handleDeclineRequest(contactUserId: string): void {
    const session_ = sessionRef.current;
    const contact = contacts.find((c) => c.userId === contactUserId);
    if (!session_ || !contact) return;
    // No ensureSessionWith needed — decline is a plain send, no Olm session
    // required (this is what the earlier "decline silently does nothing"
    // bug was actually working around; the plain-send redesign makes that
    // fix unnecessary rather than wrong).
    session_.sendContactDecline(contact.deviceIds[0]!);
    setContacts((prev) => prev.filter((c) => c.userId !== contactUserId));
  }

  function handleSaveEditedContact(nickname: string, avatarDataUrl: string | null) {
    if (!editingContact) return;
    const userId = editingContact.userId;
    setContacts((prev) => prev.map((c) => (c.userId === userId ? { ...c, nickname: nickname || null, avatarDataUrl } : c)));
    setEditingContact(null);
  }

  async function handleSend(contactUserId: string, text: string, replyToId?: string) {
    const session_ = sessionRef.current;
    if (!session_) return;
    const messageId = await session_.sendMessage(contactUserId, text, replyToId);
    const newMsg: ChatMessage = { id: messageId, direction: 'sent', body: text, timestamp: Date.now(), status: 'sent', replyToId };
    await applyConversationsUpdate(session_, (prev) => ({ ...prev, [contactUserId]: [...(prev[contactUserId] ?? []), newMsg] }));
  }

  async function handleReact(contactUserId: string, messageId: string, emoji: string) {
    const session_ = sessionRef.current;
    if (!session_) return;
    const current = conversationsRef.current[contactUserId]?.find((m) => m.id === messageId);
    const nextEmoji = current?.reactions?.mine === emoji ? null : emoji; // tap the same emoji again to clear
    await session_.sendReaction(contactUserId, messageId, nextEmoji);
    await applyConversationsUpdate(session_, (prev) => {
      const existing = prev[contactUserId];
      if (!existing) return prev;
      return {
        ...prev,
        [contactUserId]: existing.map((m) => {
          if (m.id !== messageId) return m;
          const reactions = { ...m.reactions };
          if (nextEmoji) reactions.mine = nextEmoji;
          else delete reactions.mine;
          return { ...m, reactions };
        }),
      };
    });
  }

  async function handleDeleteForMe(contactUserId: string, messageId: string) {
    const session_ = sessionRef.current;
    if (!session_) return;
    await applyConversationsUpdate(session_, (prev) => {
      const existing = prev[contactUserId];
      if (!existing) return prev;
      return { ...prev, [contactUserId]: existing.filter((m) => m.id !== messageId) };
    });
  }

  async function handleDeleteForEveryone(contactUserId: string, messageId: string) {
    const session_ = sessionRef.current;
    if (!session_) return;
    await session_.deleteMessageForEveryone(contactUserId, messageId);
    await applyConversationsUpdate(session_, (prev) => {
      const existing = prev[contactUserId];
      if (!existing) return prev;
      return { ...prev, [contactUserId]: existing.map((m) => (m.id === messageId ? { ...m, deleted: true, body: '' } : m)) };
    });
  }

  async function handleForward(targetContactUserId: string, text: string) {
    await handleSend(targetContactUserId, text);
    setForwardingMessage(null);
  }

  async function handleStartVerification(contactUserId: string, peerDeviceId: string) {
    const session_ = sessionRef.current;
    if (!session_) return;
    isSasInitiatorRefs.current.set(contactUserId, true);
    const request = await session_.requestVerification(contactUserId, peerDeviceId);
    verifRequestRefs.current.set(contactUserId, request);
    request.registerChangesCallback(async () => {
      const req = verifRequestRefs.current.get(contactUserId);
      if (!req || verifSasRefs.current.has(contactUserId)) return;
      if (req.isReady()) {
        const sas = await sessionRef.current?.startSas(req);
        if (sas) {
          verifSasRefs.current.set(contactUserId, sas);
          sas.registerChangesCallback(async () => refreshVerifState(contactUserId));
          refreshVerifState(contactUserId);
        }
      }
    });
    setVerifPhase((prev) => ({ ...prev, [contactUserId]: 'outgoing-pending' }));
  }

  function handleAcceptIncomingVerification(contactUserId: string) {
    const session_ = sessionRef.current;
    const request = verifRequestRefs.current.get(contactUserId);
    if (!session_ || !request) return;
    session_.acceptVerificationRequest(request);
  }

  async function handleConfirmMatch(contactUserId: string) {
    const session_ = sessionRef.current;
    const sas = verifSasRefs.current.get(contactUserId);
    if (!session_ || !sas) return;
    await session_.confirmSas(sas);
    setVerifPhase((prev) => ({ ...prev, [contactUserId]: 'sas-confirmed-self' }));
  }

  function handleRejectMatch(contactUserId: string) {
    const session_ = sessionRef.current;
    const sas = verifSasRefs.current.get(contactUserId);
    if (!session_ || !sas) return;
    session_.cancelSas(sas);
    setVerifPhase((prev) => ({ ...prev, [contactUserId]: 'cancelled' }));
  }

  const myShareCode = session ? encodeShareCode(session.userId, session.deviceId, ownUsername || null) : '';
  const activeContact = contacts.find((c) => c.userId === activeContactUserId) ?? null;

  if (!session) {
    return (
      <main style={{ maxWidth: 480, margin: '80px auto', padding: '0 16px', fontSize: 14, textAlign: 'center' }}>
        <h1>
          CyCove{' '}
          <span style={{ fontSize: 12, fontWeight: 700, color: '#c0392b', border: '1px solid #c0392b', borderRadius: 4, padding: '2px 6px', verticalAlign: 'middle' }}>
            OPEN ALPHA
          </span>
        </h1>
        <p style={{ color: '#666' }}>{status}</p>

        <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #ddd', justifyContent: 'center' }}>
          {(['register', 'login', 'link'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setAuthMode(m);
                setAuthError(null);
              }}
              style={{
                border: 'none',
                background: 'transparent',
                padding: '6px 10px',
                fontWeight: authMode === m ? 700 : 400,
                borderBottom: authMode === m ? '2px solid #2f6fed' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {m === 'register' ? 'Register' : m === 'login' ? 'Log in' : 'Link this device'}
            </button>
          ))}
        </div>

        {authMode === 'register' && (
          <>
            <button onClick={() => void handleRegister()}>Register new account</button>
            {recoveryKey && (
              <p style={{ background: '#fffbe6', padding: 8, marginTop: 16, textAlign: 'left' }}>
                Recovery key (test only, not the real UX): <code>{recoveryKey}</code>
              </p>
            )}
          </>
        )}

        {authMode === 'login' && (
          <div style={{ textAlign: 'left' }}>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>Username</label>
            <input
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder="e.g. alex"
              style={{ width: '100%', marginBottom: 8, padding: 6 }}
            />
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>Recovery key</label>
            <input
              value={loginRecoveryKey}
              onChange={(e) => setLoginRecoveryKey(e.target.value)}
              placeholder="paste your recovery key"
              style={{ width: '100%', marginBottom: 8, padding: 6, fontFamily: 'monospace' }}
            />
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={() => void handleLogin(loginUsername.trim(), loginRecoveryKey.trim())}
                disabled={!loginUsername.trim() || !loginRecoveryKey.trim()}
              >
                Log in
              </button>
            </div>
            {authError === 'KEYS_NOT_ON_THIS_DEVICE' ? (
              <p style={{ color: 'crimson', fontSize: 13, marginTop: 8 }}>
                This browser doesn't have your account's encryption keys — they only ever exist on the device that
                created them, never on our servers. To use this account here, generate a pairing code on a device
                where you're already logged in, then{' '}
                <button
                  onClick={() => {
                    setAuthMode('link');
                    setAuthError(null);
                  }}
                  style={{ padding: '2px 6px', fontSize: 13 }}
                >
                  link this device instead
                </button>
                .
              </p>
            ) : (
              authError && <p style={{ color: 'crimson', fontSize: 13, marginTop: 8 }}>{authError}</p>
            )}
          </div>
        )}

        {authMode === 'link' && (
          <div style={{ textAlign: 'left' }}>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              Pairing code — generate one from a device you're already logged into ("Link a device")
            </label>

            {showQrScanner ? (
              <>
                <QrScanner
                  onDecode={(text) => {
                    setLinkPairingCode(text);
                    setShowQrScanner(false);
                  }}
                />
                <button onClick={() => setShowQrScanner(false)} style={{ marginBottom: 8 }}>
                  Cancel scan
                </button>
              </>
            ) : (
              <button onClick={() => setShowQrScanner(true)} style={{ marginBottom: 8 }}>
                Scan QR code
              </button>
            )}

            <textarea
              value={linkPairingCode}
              onChange={(e) => setLinkPairingCode(e.target.value)}
              placeholder="or paste the pairing code here"
              rows={2}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}
            />
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
              Recovery key (optional — also restores your contacts on this device)
            </label>
            <input
              value={linkRecoveryKey}
              onChange={(e) => setLinkRecoveryKey(e.target.value)}
              placeholder="paste your recovery key"
              style={{ width: '100%', marginBottom: 8, padding: 6, fontFamily: 'monospace' }}
            />
            <div style={{ textAlign: 'center' }}>
              <button onClick={() => void handleLinkDevice(linkPairingCode.trim(), linkRecoveryKey)} disabled={!linkPairingCode.trim()}>
                Link this device
              </button>
            </div>
            {authError && authError !== 'KEYS_NOT_ON_THIS_DEVICE' && (
              <p style={{ color: 'crimson', fontSize: 13, marginTop: 8 }}>{authError}</p>
            )}
          </div>
        )}
      </main>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontSize: 14 }}>
      {recoveryKey && (
        <div style={{ background: '#fffbe6', padding: 8, borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>
            Recovery key (test only, not the real UX — you'll need this to log in again or link another device):{' '}
            <code>{recoveryKey}</code>
          </span>
          <button onClick={() => setRecoveryKey(null)} style={{ flexShrink: 0 }}>
            I've saved it
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar
        contacts={contacts}
        conversations={conversations}
        activeContactUserId={activeContactUserId}
        verifPhase={verifPhase}
        typingContacts={typingContacts}
        readReceiptsEnabled={readReceiptsEnabled}
        onToggleReadReceipts={() => setReadReceiptsEnabled((v) => !v)}
        onSelectContact={setActiveContactUserId}
        onShowAddContact={() => setShowAddContact(true)}
        onAcceptRequest={(userId) => void handleAcceptRequest(userId)}
        onDeclineRequest={(userId) => void handleDeclineRequest(userId)}
        onEditContact={setEditingContact}
        onShowLinkDevice={() => void handleRequestPairingCode()}
        onShowDevices={() => void handleShowDevices()}
        onLogout={handleLogout}
      />

      {activeContact ? (
        <Conversation
          key={activeContact.userId}
          contact={activeContact}
          messages={conversations[activeContact.userId] ?? []}
          verifPhase={verifPhase[activeContact.userId] ?? 'idle'}
          verifEmoji={verifEmoji[activeContact.userId] ?? null}
          isPeerTyping={typingContacts[activeContact.userId] ?? false}
          onSend={(text, replyToId) => void handleSend(activeContact.userId, text, replyToId)}
          onTypingStart={() => void sessionRef.current?.sendTyping(activeContact.userId, 'start')}
          onTypingStop={() => void sessionRef.current?.sendTyping(activeContact.userId, 'stop')}
          onStartVerification={() => void handleStartVerification(activeContact.userId, activeContact.deviceIds[0]!)}
          onAcceptVerification={() => handleAcceptIncomingVerification(activeContact.userId)}
          onConfirmMatch={() => void handleConfirmMatch(activeContact.userId)}
          onRejectMatch={() => handleRejectMatch(activeContact.userId)}
          onReact={(messageId, emoji) => void handleReact(activeContact.userId, messageId, emoji)}
          onDeleteForMe={(messageId) => void handleDeleteForMe(activeContact.userId, messageId)}
          onDeleteForEveryone={(messageId) => void handleDeleteForEveryone(activeContact.userId, messageId)}
          onForward={(message) => setForwardingMessage(message)}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
          <p>{status} — add a contact to start chatting.</p>
        </div>
      )}
      </div>

      {showAddContact && (
        <AddContactPanel
          myShareCode={myShareCode}
          ownUsername={ownUsername}
          onOwnUsernameChange={setOwnUsername}
          onClaimUsername={handleClaimUsername}
          onLookupUsername={handleLookupUsername}
          onSendRequest={handleSendRequest}
          onClose={() => setShowAddContact(false)}
        />
      )}

      {editingContact && (
        <EditContactPanel contact={editingContact} onSave={handleSaveEditedContact} onClose={() => setEditingContact(null)} />
      )}

      {showLinkDevicePanel && (
        <LinkDevicePanel
          pairingCode={pairingCode}
          expiresAt={pairingExpiresAt}
          onRequestNewCode={() => void handleRequestPairingCode()}
          onClose={() => setShowLinkDevicePanel(false)}
        />
      )}

      {showDevicesPanel && session && (
        <DevicesPanel
          devices={devices}
          currentDeviceId={session.deviceId}
          onRevoke={(deviceId) => void handleRevokeDevice(deviceId)}
          onClose={() => setShowDevicesPanel(false)}
        />
      )}

      {forwardingMessage && (
        <ForwardMessagePanel
          contacts={contacts.filter((c) => c.status === 'connected' && verifPhase[c.userId] === 'verified')}
          onForward={(targetContactUserId) => void handleForward(targetContactUserId, forwardingMessage.body)}
          onClose={() => setForwardingMessage(null)}
        />
      )}
    </div>
  );
}
