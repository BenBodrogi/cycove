export const metadata = {
  title: 'CyCove — OPEN ALPHA',
  description: 'CyCove E2EE messenger — open alpha.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-monospace, monospace', margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
