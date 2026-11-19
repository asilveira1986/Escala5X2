import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'JornadaCerta', description: 'Adequação à escala 5x2, sem complicação',
  applicationName: 'JornadaCerta', manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'JornadaCerta', statusBarStyle: 'default' as const },
};
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#1f5eff' }, { media: '(prefers-color-scheme: dark)', color: '#0a1020' }], width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
