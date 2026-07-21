'use client';

import type { Emoji } from '@matrix-org/matrix-sdk-crypto-wasm';
import type { VerifPhase } from '../ClientApp';

interface VerificationPanelProps {
  phase: VerifPhase;
  emoji: Emoji[] | null;
  onStart: () => void;
  onAccept: () => void;
  onConfirm: () => void;
  onReject: () => void;
}

export default function VerificationPanel({ phase, emoji, onStart, onAccept, onConfirm, onReject }: VerificationPanelProps) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, margin: '0 16px 12px', background: '#fafafa' }}>
      {phase === 'idle' && (
        <button onClick={onStart}>Verify this contact</button>
      )}
      {phase === 'outgoing-pending' && <p style={{ margin: 0 }}>Waiting for the other side to accept…</p>}
      {phase === 'incoming-pending' && (
        <div>
          <p style={{ margin: '0 0 8px' }}>They want to verify this connection.</p>
          <button onClick={onAccept}>Accept</button>
        </div>
      )}
      {(phase === 'sas-comparing' || phase === 'sas-confirmed-self') && emoji && (
        <div>
          <p style={{ margin: '0 0 8px' }}>Compare these emoji out loud or in person — they must match exactly on both screens:</p>
          <div style={{ fontSize: 28, letterSpacing: 8 }}>
            {emoji.map((e, i) => (
              <span key={i} title={e.description}>
                {e.symbol}
              </span>
            ))}
          </div>
          {phase === 'sas-comparing' ? (
            <div style={{ marginTop: 8 }}>
              <button onClick={onConfirm}>They match</button>
              <button onClick={onReject} style={{ marginLeft: 8 }}>
                They don't match
              </button>
            </div>
          ) : (
            <p style={{ color: '#666', margin: '8px 0 0' }}>Confirmed on this side — waiting for the other side…</p>
          )}
        </div>
      )}
      {phase === 'verified' && <p style={{ color: 'green', margin: 0 }}>✓ Verified — safety numbers match.</p>}
      {phase === 'cancelled' && (
        <div>
          <p style={{ color: 'crimson', margin: '0 0 8px' }}>Verification cancelled — the emoji didn't match, or it was rejected.</p>
          <button onClick={onStart}>Try again</button>
        </div>
      )}
    </div>
  );
}
