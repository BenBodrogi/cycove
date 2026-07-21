'use client';

import dynamic from 'next/dynamic';

// ClientApp imports matrix-sdk-crypto-wasm (via src/lib/crypto.ts), which
// can only load in a real browser — ssr:false keeps Next.js from trying to
// evaluate it during the build's static prerender, which fails there.
const ClientApp = dynamic(() => import('./ClientApp'), { ssr: false });

export default function Page() {
  return <ClientApp />;
}
