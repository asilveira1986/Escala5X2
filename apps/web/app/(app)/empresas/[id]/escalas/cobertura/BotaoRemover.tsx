'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao } from '@/components/ui';

/** Botão de remover com confirmação; `acao` devolve { erro } em falha. */
export function BotaoRemover({ acao, rotulo, confirmacao }: { acao: () => Promise<{ erro?: string }>; rotulo: string; confirmacao: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Botao variante="secundario" aria-label={rotulo} disabled={pendente} onClick={() => iniciar(async () => {
        if (!window.confirm(confirmacao)) return;
        const r = await acao();
        setErro(r.erro ?? null);
      })}>{pendente ? 'Removendo…' : 'Remover'}</Botao>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </span>
  );
}
