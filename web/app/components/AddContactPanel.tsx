'use client';

import { useState } from 'react';
import { decodeShareCode } from '../../src/lib/store';
import { useEscapeKey } from '../../src/lib/useEscapeKey';

interface ResolvedPeer {
  userId: string;
  deviceId: string;
  username: string | null;
}

interface AddContactPanelProps {
  myShareCode: string;
  ownUsername: string;
  onOwnUsernameChange: (username: string) => void;
  onClaimUsername: (username: string) => Promise<void>;
  onLookupUsername: (username: string) => Promise<{ userId: string; deviceId: string } | null>;
  onSendRequest: (peer: ResolvedPeer, nickname: string) => Promise<void>;
  onClose: () => void;
}

export default function AddContactPanel({
  myShareCode,
  ownUsername,
  onOwnUsernameChange,
  onClaimUsername,
  onLookupUsername,
  onSendRequest,
  onClose,
}: AddContactPanelProps) {
  const [theirUsername, setTheirUsername] = useState('');
  const [theirCode, setTheirCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [claimStatus, setClaimStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [claimError, setClaimError] = useState<string | null>(null);

  useEscapeKey(onClose);

  async function handleClaimUsername() {
    setClaimStatus('saving');
    setClaimError(null);
    try {
      await onClaimUsername(ownUsername.trim());
      setClaimStatus('saved');
    } catch (err) {
      setClaimStatus('error');
      setClaimError(err instanceof Error ? err.message : 'Could not claim that username.');
    }
  }

  async function resolvePeer(): Promise<ResolvedPeer | null> {
    if (theirUsername.trim()) {
      const found = await onLookupUsername(theirUsername.trim());
      if (!found) {
        setError(`No one found with username "${theirUsername.trim()}".`);
        return null;
      }
      return { userId: found.userId, deviceId: found.deviceId, username: theirUsername.trim() };
    }
    if (theirCode.trim()) {
      const decoded = decodeShareCode(theirCode);
      if (!decoded) {
        setError("That share code doesn't look valid.");
        return null;
      }
      return decoded;
    }
    setError('Enter their username or paste a share code.');
    return null;
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const peer = await resolvePeer();
      if (!peer) return;
      await onSendRequest(peer, nickname.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: 'white', borderRadius: 8, padding: 20, width: 420, maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Add a contact</h2>

        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>Your username</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            value={ownUsername}
            onChange={(e) => {
              onOwnUsernameChange(e.target.value);
              setClaimStatus('idle');
            }}
            placeholder="e.g. alex"
            style={{ flex: 1, padding: 6 }}
          />
          <button onClick={() => void handleClaimUsername()} disabled={!ownUsername.trim() || claimStatus === 'saving'}>
            {claimStatus === 'saving' ? 'Saving…' : 'Set'}
          </button>
        </div>
        {claimStatus === 'saved' && <p style={{ color: 'green', fontSize: 12, marginTop: 0 }}>Saved — others can now find you by this username.</p>}
        {claimStatus === 'error' && <p style={{ color: 'crimson', fontSize: 12, marginTop: 0 }}>{claimError}</p>}

        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4, marginTop: 12 }}>
          Your share code — an alternative to your username
        </label>
        <textarea readOnly value={myShareCode} rows={2} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginBottom: 16 }} />

        <p style={{ fontSize: 12, color: '#888', marginTop: 12, marginBottom: 12 }}>
          Sends a request they must accept before you're connected — this confirms they're actually reachable and
          keeps both of you in sync before verification starts.
        </p>

        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>Their username</label>
        <input
          value={theirUsername}
          onChange={(e) => setTheirUsername(e.target.value)}
          placeholder="e.g. alex"
          style={{ width: '100%', marginBottom: 8, padding: 6 }}
        />

        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>Or their share code</label>
        <textarea
          placeholder="paste their share code here"
          value={theirCode}
          onChange={(e) => setTheirCode(e.target.value)}
          rows={2}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}
        />

        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>Nickname (optional, only visible to you)</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="e.g. Alex"
          style={{ width: '100%', marginBottom: 12, padding: 6 }}
        />

        {error && <p style={{ color: 'crimson', fontSize: 13 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => void handleSubmit()} disabled={(!theirUsername.trim() && !theirCode.trim()) || submitting}>
            {submitting ? 'Working…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  );
}
