'use client';

import { useState, type ChangeEvent } from 'react';
import type { Contact } from '../../src/lib/store';
import { fileToAvatarDataUrl } from '../../src/lib/store';
import Avatar from './Avatar';

interface EditContactPanelProps {
  contact: Contact;
  onSave: (nickname: string, avatarDataUrl: string | null) => void;
  onClose: () => void;
}

export default function EditContactPanel({ contact, onSave, onClose }: EditContactPanelProps) {
  const [nickname, setNickname] = useState(contact.nickname ?? '');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(contact.avatarDataUrl);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarDataUrl(await fileToAvatarDataUrl(file));
    } catch {
      setError('Could not read that image — try a different file.');
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
      onClick={onClose}
    >
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: 360, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Edit contact</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Avatar avatarDataUrl={avatarDataUrl} label={nickname || contact.theirUsername || contact.userId} size={56} />
          <label style={{ fontSize: 13, color: '#2f6fed', cursor: 'pointer' }}>
            Change picture
            <input type="file" accept="image/*" onChange={(e) => void handleFile(e)} style={{ display: 'none' }} />
          </label>
          {avatarDataUrl && (
            <button onClick={() => setAvatarDataUrl(null)} style={{ fontSize: 12 }}>
              Remove
            </button>
          )}
        </div>

        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>Nickname</label>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} style={{ width: '100%', marginBottom: 12, padding: 6 }} />

        {error && <p style={{ color: 'crimson', fontSize: 13 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => onSave(nickname.trim(), avatarDataUrl)}>Save</button>
        </div>
      </div>
    </div>
  );
}
