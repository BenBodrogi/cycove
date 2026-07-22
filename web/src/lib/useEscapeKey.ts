import { useEffect } from 'react';

// Shared by every fixed-position modal panel (AddContactPanel, EditContactPanel,
// LinkDevicePanel, DevicesPanel, ForwardMessagePanel) — they already close on a
// backdrop click, this adds the other standard dismiss path.
export function useEscapeKey(onEscape: () => void): void {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape]);
}
