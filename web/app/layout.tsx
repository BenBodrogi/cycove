export const metadata = {
  title: 'CyCove — dev test client',
  description: 'Minimal test UI for CyCove E2EE — not the real product UI, see Projects/CyCove.md.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-monospace, monospace', margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
