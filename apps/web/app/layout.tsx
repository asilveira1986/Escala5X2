import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'JornadaCerta', description: 'Adequação à escala 5x2 (EC 141/2026)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
