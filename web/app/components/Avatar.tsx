'use client';

import type { CSSProperties } from 'react';

interface AvatarProps {
  avatarDataUrl: string | null;
  label: string;
  size?: number;
}

function colorForLabel(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 55%, 45%)`;
}

export default function Avatar({ avatarDataUrl, label, size = 36 }: AvatarProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.45,
    fontWeight: 600,
    color: 'white',
    overflow: 'hidden',
  };

  if (avatarDataUrl) {
    return <img src={avatarDataUrl} alt={label} style={{ ...style, objectFit: 'cover' }} />;
  }

  const initial = label.trim().charAt(0).toUpperCase() || '?';
  return (
    <div style={{ ...style, background: colorForLabel(label) }} title={label}>
      {initial}
    </div>
  );
}
