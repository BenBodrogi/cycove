'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface QrScannerProps {
  onDecode: (text: string) => void;
}

// Camera-based QR scanning for "Link this device" — decodes into the exact
// same pairing-code string the manual-paste textarea already accepts, so
// nothing downstream (decodePairingCode/linkDevice) needs to know which
// path produced it. Not the newer native BarcodeDetector API: it isn't
// supported in Safari/iOS, and "a phone via a browser" has to mean that too.
export default function QrScanner({ onDecode }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decodedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          // Component unmounted while the permission prompt was up — don't
          // leave the camera running with nothing watching it.
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const tick = () => {
          if (cancelled || decodedRef.current) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(imageData.data, imageData.width, imageData.height);
            if (result?.data) {
              decodedRef.current = true;
              stream.getTracks().forEach((t) => t.stop());
              onDecode(result.data);
              return;
            }
          }
          frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof DOMException && err.name === 'NotAllowedError'
              ? 'Camera access was denied — paste the code below instead.'
              : "Couldn't access the camera — paste the code below instead.",
          );
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDecode is expected to be stable per mount; re-subscribing mid-scan would restart the camera
  }, []);

  if (error) {
    return <p style={{ color: 'crimson', fontSize: 13 }}>{error}</p>;
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 4, background: '#000' }} />
      <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Point the camera at the pairing QR code.</p>
    </div>
  );
}
