'use client';

import { useState } from 'react';
import { useEscapeKey } from '../../src/lib/useEscapeKey';

interface DeviceRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
}

interface DevicesPanelProps {
  devices: DeviceRow[];
  currentDeviceId: string;
  onRevoke: (deviceId: string) => void;
  onClose: () => void;
}

export default function DevicesPanel({ devices, currentDeviceId, onRevoke, onClose }: DevicesPanelProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEscapeKey(onClose);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
      onClick={onClose}
    >
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: 480, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Your devices</h2>
        <p style={{ fontSize: 12, color: '#888', marginTop: 0, marginBottom: 12 }}>
          Every device linked to this account. Revoking a device ends its session immediately — including this one,
          if you pick it.
        </p>

        <div style={{ marginBottom: 12 }}>
          {devices.map((device) => {
            const isCurrent = device.id === currentDeviceId;
            const confirming = confirmingId === device.id;
            return (
              <div
                key={device.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid #eee',
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {device.id.slice(0, 12)}… {isCurrent && <span style={{ color: '#2f6fed' }}>(this device)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    Linked {new Date(device.createdAt).toLocaleString()} — last seen {new Date(device.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                {confirming ? (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: 'crimson' }}>{isCurrent ? 'Log you out here?' : 'Really revoke?'}</span>
                    <button onClick={() => onRevoke(device.id)} style={{ fontSize: 12 }}>
                      Yes
                    </button>
                    <button onClick={() => setConfirmingId(null)} style={{ fontSize: 12 }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmingId(device.id)} style={{ fontSize: 12, flexShrink: 0 }}>
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
