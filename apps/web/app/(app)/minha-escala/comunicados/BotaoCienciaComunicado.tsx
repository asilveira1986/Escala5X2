'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao } from '@/components/ui';
import { darCienciaComunicado } from '../actions';

export function BotaoCienciaComunicado({ id }: { id: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <div className="space-y-2">
      <Botao disabled={pendente} onClick={() => iniciar(async () => { setErro(null); const r = await darCienciaComunicado(id); if (!r.ok) setErro(r.erro); })}>
        {pendente ? 'Registrando…' : 'Li e estou ciente'}
      </Botao>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </div>
  );
}
