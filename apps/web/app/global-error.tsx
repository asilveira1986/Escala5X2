'use client';

import { ErroTela } from '@/components/ErroTela';

/** Último recurso: erro no próprio layout raiz. Precisa trazer <html> e <body>. */
export default function ErroGlobal(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f4f6fb', padding: '2rem' }}>
        <ErroTela {...props} />
      </body>
    </html>
  );
}
