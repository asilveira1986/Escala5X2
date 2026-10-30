import type { ReactNode } from 'react';

export const metadata = { title: 'JornadaCerta', description: 'Adequação à escala 5x2' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <main style={{ maxWidth: 420, margin: '10vh auto', padding: 16 }}>{children}</main>
      </body>
    </html>
  );
}
