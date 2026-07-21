'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface LinkDevicePanelProps {
  pairingCode: string | null;
  expiresAt: number | null;
  onRequestNewCode: () => void;
  onClose: () => void;
}

export default function LinkDevicePanel({ pairingCode, expiresAt, onRequestNewCode, onClose }: LinkDevicePanelProps) {
  const [secondsLeft, setSecondsLeft] = useState(() => (expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 1000)) : 0));
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Same pairing code the textarea below shows as text — the QR is just a
  // different encoding of the identical secret, not a separate mechanism.
  useEffect(() => {
    if (!pairingCode) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(pairingCode, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [pairingCode]);

  const expired = expiresAt !== null && secondsLeft <= 0;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
      onClick={onClose}
    >
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: 420, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Link a device</h2>
        <p style={{ fontSize: 12, color: '#888', marginTop: 0, marginBottom: 12 }}>
          Paste this code into the "Link this device" tab on the other device, before it expires. The new device gets
          its own keys, not a copy of this device's — but keep this panel (or "Your devices") open until it links:
          your contacts inherit trust in the new device automatically, and this device pushes its own local chat
          history to it, both as soon as it notices the new device appear. If no device is open around the time it
          links, that catches up next time one of your other devices reconnects — but history only ever transfers
          from a device that was actually online to send it, so if none ever comes online again, it can't be recovered.
        </p>

        {qrDataUrl && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, not something next/image's optimizer applies to */}
            <img src={qrDataUrl} alt="Pairing code QR" width={220} height={220} style={{ opacity: expired ? 0.35 : 1 }} />
          </div>
        )}

        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>Or paste this code</label>
        <textarea readOnly value={pairingCode ?? ''} rows={2} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }} />

        <p style={{ fontSize: 13, marginBottom: 12, color: expired ? 'crimson' : '#666' }}>
          {expired ? 'Expired.' : `Expires in ${secondsLeft}s.`}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose}>Close</button>
          <button onClick={onRequestNewCode}>{expired ? 'Generate new code' : 'Regenerate'}</button>
        </div>
      </div>
    </div>
  );
}
