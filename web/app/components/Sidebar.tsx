'use client';

import type { Contact, ChatMessage } from '../../src/lib/store';
import type { VerifPhase } from '../ClientApp';
import Avatar from './Avatar';

interface SidebarProps {
  contacts: Contact[];
  conversations: Record<string, ChatMessage[]>;
  activeContactUserId: string | null;
  verifPhase: Record<string, VerifPhase>;
  typingContacts: Record<string, boolean>;
  readReceiptsEnabled: boolean;
  onToggleReadReceipts: () => void;
  onSelectContact: (userId: string) => void;
  onShowAddContact: () => void;
  onAcceptRequest: (userId: string) => void;
  onDeclineRequest: (userId: string) => void;
  onEditContact: (contact: Contact) => void;
  onShowLinkDevice: () => void;
  onShowDevices: () => void;
  onLogout: () => void;
}

export function contactLabel(contact: Contact): string {
  return contact.nickname ?? contact.theirUsername ?? contact.userId.replace(/^@/, '').slice(0, 12) + '…';
}

export default function Sidebar({
  contacts,
  conversations,
  activeContactUserId,
  verifPhase,
  typingContacts,
  readReceiptsEnabled,
  onToggleReadReceipts,
  onSelectContact,
  onShowAddContact,
  onAcceptRequest,
  onDeclineRequest,
  onEditContact,
  onShowLinkDevice,
  onShowDevices,
  onLogout,
}: SidebarProps) {
  return (
    <aside
      style={{
        width: 280,
        borderRight: '1px solid #ddd',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div style={{ padding: 12, borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>CyCove</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onShowAddContact} title="Add a contact">
            + Add
          </button>
          <button onClick={onShowLinkDevice} title="Link a device">
            Link a device
          </button>
          <button onClick={onShowDevices} title="Your devices">
            Your devices
          </button>
          <button
            onClick={onToggleReadReceipts}
            title={readReceiptsEnabled ? 'Read receipts on — click to stop sending them' : 'Read receipts off — click to resume sending them'}
          >
            Read receipts: {readReceiptsEnabled ? 'on' : 'off'}
          </button>
          <button onClick={onLogout} title="Log out">
            Log out
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {contacts.length === 0 && (
          <p style={{ padding: 12, color: '#888', fontSize: 13 }}>No contacts yet. Click "+ Add" to connect with someone.</p>
        )}
        {contacts.map((contact) => {
          const label = contactLabel(contact);
          const lastMessage = conversations[contact.userId]?.at(-1);
          const verified = verifPhase[contact.userId] === 'verified';
          const isActive = contact.userId === activeContactUserId;
          const rowStyle = {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            textAlign: 'left' as const,
            padding: '10px 12px',
            border: 'none',
            borderBottom: '1px solid #eee',
            background: isActive ? '#eef4ff' : 'transparent',
          };

          if (contact.status === 'pending-incoming') {
            return (
              <div key={contact.userId} style={rowStyle}>
                <Avatar avatarDataUrl={contact.avatarDataUrl} label={label} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>wants to connect</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => onAcceptRequest(contact.userId)} style={{ fontSize: 12 }}>
                      Accept
                    </button>
                    <button onClick={() => onDeclineRequest(contact.userId)} style={{ fontSize: 12 }}>
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={contact.userId} style={{ ...rowStyle, cursor: 'pointer' }} onClick={() => onSelectContact(contact.userId)}>
              <Avatar avatarDataUrl={contact.avatarDataUrl} label={label} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{label}</span>
                  {contact.status === 'connected' && (
                    <span title={verified ? 'Verified' : 'Not verified'} style={{ fontSize: 12, color: verified ? 'green' : '#aaa' }}>
                      {verified ? '✓' : '○'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {contact.status === 'pending-outgoing'
                    ? 'Request sent — waiting…'
                    : typingContacts[contact.userId]
                      ? 'typing…'
                      : lastMessage
                        ? `${lastMessage.direction === 'sent' ? 'You: ' : ''}${lastMessage.body}`
                        : ''}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditContact(contact);
                }}
                title="Edit contact"
                style={{ fontSize: 12, border: 'none', background: 'transparent', cursor: 'pointer', color: '#999' }}
              >
                ✎
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
