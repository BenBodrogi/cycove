'use client';

import type { Contact } from '../../src/lib/store';
import { contactLabel } from './Sidebar';
import Avatar from './Avatar';

interface ForwardMessagePanelProps {
  contacts: Contact[];
  onForward: (targetContactUserId: string) => void;
  onClose: () => void;
}

// Same modal-panel convention as AddContactPanel/EditContactPanel/DevicesPanel.
// Only lists verified, connected contacts — matches Conversation.tsx's own
// canMessage gate, since forwarding is just composing a new message under
// the hood (sendMessage), which already requires that.
export default function ForwardMessagePanel({ contacts, onForward, onClose }: ForwardMessagePanelProps) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
      onClick={onClose}
    >
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: 360, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Forward to…</h2>

        {contacts.length === 0 ? (
          <p style={{ color: '#888', fontSize: 13 }}>No verified contacts to forward to yet.</p>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {contacts.map((contact) => {
              const label = contactLabel(contact);
              return (
                <button
                  key={contact.userId}
                  onClick={() => onForward(contact.userId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 6px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <Avatar avatarDataUrl={contact.avatarDataUrl} label={label} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
