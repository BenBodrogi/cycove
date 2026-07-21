'use client';

import { useEffect, useRef, useState } from 'react';
import type { Emoji } from '@matrix-org/matrix-sdk-crypto-wasm';
import type { Contact, ChatMessage } from '../../src/lib/store';
import type { VerifPhase } from '../ClientApp';
import VerificationPanel from './VerificationPanel';
import Avatar from './Avatar';
import { contactLabel } from './Sidebar';

interface ConversationProps {
  contact: Contact;
  messages: ChatMessage[];
  verifPhase: VerifPhase;
  verifEmoji: Emoji[] | null;
  isPeerTyping: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onStartVerification: () => void;
  onAcceptVerification: () => void;
  onConfirmMatch: () => void;
  onRejectMatch: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onDeleteForMe: (messageId: string) => void;
  onDeleteForEveryone: (messageId: string) => void;
  onForward: (message: ChatMessage) => void;
}

const STATUS_LABEL: Record<ChatMessage['status'], string> = {
  sent: '✓ sent',
  delivered: '✓✓ delivered',
  read: '✓✓ read',
};

// Fixed small set, not a full emoji picker — matches this app's plain style
// and minimal-dependencies bias (same reasoning jsqr was chosen over pulling
// in a whole QR library ecosystem).
const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function Conversation({
  contact,
  messages,
  verifPhase,
  verifEmoji,
  isPeerTyping,
  onSend,
  onTypingStart,
  onTypingStop,
  onStartVerification,
  onAcceptVerification,
  onConfirmMatch,
  onRejectMatch,
  onReact,
  onDeleteForMe,
  onDeleteForEveryone,
  onForward,
}: ConversationProps) {
  const [compose, setCompose] = useState('');
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [reactingToId, setReactingToId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isTypingRef = useRef(false);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      if (isTypingRef.current) onTypingStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.userId]);

  const verified = verifPhase === 'verified';
  const canMessage = contact.status === 'connected' && verified;
  const panelOpen = verificationOpen || (verifPhase !== 'idle' && verifPhase !== 'verified');
  const label = contactLabel(contact);

  function findMessage(id: string): ChatMessage | undefined {
    return messages.find((m) => m.id === id);
  }

  function handleComposeChange(value: string) {
    setCompose(value);
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTypingStart();
    }
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      onTypingStop();
    }, 4000);
  }

  function handleSend() {
    if (!compose.trim()) return;
    onSend(compose, replyingTo?.id);
    setCompose('');
    setReplyingTo(null);
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    isTypingRef.current = false;
    onTypingStop();
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div style={{ padding: 12, borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar avatarDataUrl={contact.avatarDataUrl} label={label} />
        <strong>{label}</strong>
        {contact.status === 'connected' && (
          <button
            onClick={() => setVerificationOpen((v) => !v)}
            title={verified ? 'Verified — click for details' : 'Not verified — click to verify'}
            style={{
              fontSize: 12,
              padding: '2px 8px',
              borderRadius: 10,
              border: '1px solid ' + (verified ? '#2a7a2a' : '#bbb'),
              color: verified ? '#2a7a2a' : '#888',
              background: verified ? '#eaf7ea' : '#f4f4f4',
              cursor: 'pointer',
            }}
          >
            {verified ? '✓ Verified' : '○ Not verified'}
          </button>
        )}
      </div>

      {contact.status === 'pending-outgoing' ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', padding: 24, textAlign: 'center' }}>
          <p>Request sent to {label} — waiting for them to accept before you can message.</p>
        </div>
      ) : (
        <>
          {panelOpen && (
            <VerificationPanel
              phase={verifPhase}
              emoji={verifEmoji}
              onStart={onStartVerification}
              onAccept={onAcceptVerification}
              onConfirm={onConfirmMatch}
              onReject={onRejectMatch}
            />
          )}

          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && <p style={{ color: '#999', fontSize: 13 }}>No messages yet — say hello.</p>}
            {messages.map((m) => {
              const quoted = m.replyToId ? findMessage(m.replyToId) : undefined;
              return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.direction === 'sent' ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '70%',
                      padding: '8px 12px',
                      borderRadius: 12,
                      background: m.deleted ? '#f4f4f4' : m.direction === 'sent' ? (m.status === 'sent' ? '#8fb3f7' : '#2f6fed') : '#eee',
                      color: m.deleted ? '#888' : m.direction === 'sent' ? 'white' : 'black',
                    }}
                  >
                    {!m.deleted && m.replyToId && (
                      <div
                        style={{
                          fontSize: 11,
                          opacity: 0.75,
                          borderLeft: '2px solid currentColor',
                          paddingLeft: 6,
                          marginBottom: 4,
                          wordBreak: 'break-word',
                        }}
                      >
                        {quoted && !quoted.deleted ? quoted.body : 'Original message'}
                      </div>
                    )}
                    <div style={{ wordBreak: 'break-word', fontStyle: m.deleted ? 'italic' : 'normal' }}>
                      {m.deleted ? 'This message was deleted' : m.body}
                    </div>
                    {m.direction === 'sent' && !m.deleted && (
                      <div style={{ fontSize: 10, opacity: m.status === 'read' ? 1 : 0.8, textAlign: 'right', marginTop: 2 }}>
                        {STATUS_LABEL[m.status]}
                      </div>
                    )}
                  </div>

                  {!m.deleted && (m.reactions?.mine || m.reactions?.theirs) && (
                    <div style={{ fontSize: 12, marginTop: 2, display: 'flex', gap: 4 }}>
                      {m.reactions?.mine && (
                        <span style={{ background: '#eef4ff', borderRadius: 10, padding: '1px 6px' }}>{m.reactions.mine}</span>
                      )}
                      {m.reactions?.theirs && (
                        <span style={{ background: '#f4f4f4', borderRadius: 10, padding: '1px 6px' }}>{m.reactions.theirs}</span>
                      )}
                    </div>
                  )}

                  {!m.deleted && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                      <button
                        onClick={() => setReplyingTo(m)}
                        style={{ fontSize: 10, border: 'none', background: 'transparent', color: '#999', cursor: 'pointer', padding: 0 }}
                      >
                        Reply
                      </button>
                      <button
                        onClick={() => setReactingToId(reactingToId === m.id ? null : m.id)}
                        style={{ fontSize: 10, border: 'none', background: 'transparent', color: '#999', cursor: 'pointer', padding: 0 }}
                      >
                        React
                      </button>
                      <button
                        onClick={() => onForward(m)}
                        style={{ fontSize: 10, border: 'none', background: 'transparent', color: '#999', cursor: 'pointer', padding: 0 }}
                      >
                        Forward
                      </button>
                      {m.direction === 'sent' && (
                        <>
                          <button
                            onClick={() => onDeleteForMe(m.id)}
                            style={{ fontSize: 10, border: 'none', background: 'transparent', color: '#999', cursor: 'pointer', padding: 0 }}
                          >
                            Delete for me
                          </button>
                          <button
                            onClick={() => onDeleteForEveryone(m.id)}
                            style={{ fontSize: 10, border: 'none', background: 'transparent', color: '#999', cursor: 'pointer', padding: 0 }}
                          >
                            Delete for everyone
                          </button>
                        </>
                      )}
                      {m.direction === 'received' && (
                        <button
                          onClick={() => onDeleteForMe(m.id)}
                          style={{ fontSize: 10, border: 'none', background: 'transparent', color: '#999', cursor: 'pointer', padding: 0 }}
                        >
                          Delete for me
                        </button>
                      )}
                    </div>
                  )}

                  {reactingToId === m.id && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                      {REACTION_EMOJI.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            onReact(m.id, emoji);
                            setReactingToId(null);
                          }}
                          style={{ fontSize: 14, border: 'none', background: 'transparent', cursor: 'pointer', padding: 2 }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {isPeerTyping && <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>{label} is typing…</div>}
            <div ref={bottomRef} />
          </div>

          {canMessage ? (
            <div style={{ borderTop: '1px solid #ddd' }}>
              {replyingTo && (
                <div style={{ padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9f9f9', fontSize: 12 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Replying to: {replyingTo.deleted ? 'This message was deleted' : replyingTo.body}
                  </span>
                  <button onClick={() => setReplyingTo(null)} style={{ border: 'none', background: 'transparent', color: '#999', cursor: 'pointer' }}>
                    ✕
                  </button>
                </div>
              )}
              <div style={{ padding: 12, display: 'flex', gap: 8 }}>
                <input
                  value={compose}
                  onChange={(e) => handleComposeChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSend();
                  }}
                  placeholder="Message"
                  style={{ flex: 1, padding: 8 }}
                />
                <button onClick={handleSend} disabled={!compose.trim()}>
                  Send
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: 16, borderTop: '1px solid #ddd', textAlign: 'center' }}>
              <p style={{ margin: '0 0 8px', color: '#666', fontSize: 13 }}>
                Verify {label} to start messaging — this confirms you're really talking to them, not an impostor.
              </p>
              {!panelOpen && (
                <button
                  onClick={() => {
                    setVerificationOpen(true);
                    if (verifPhase === 'idle') onStartVerification();
                  }}
                >
                  Verify this contact
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
