'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Botao } from '@/components/ui';

export function MarcarTodas() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <Botao variante="secundario" disabled={pendente} onClick={() => iniciar(async () => {
      try { await fetch('/api/v1/notificacoes/lidas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch { /* tenta de novo */ }
      router.refresh();
    })}>{pendente ? 'Marcando…' : 'Marcar todas como lidas'}</Botao>
  );
}
