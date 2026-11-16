'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao } from '@/components/ui';
import { darCiencia } from './actions';

export function BotaoCiencia({ escalaId }: { escalaId: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <div className="space-y-2">
      <Botao disabled={pendente} onClick={() => iniciar(async () => { setErro(null); const r = await darCiencia(escalaId); if (!r.ok) setErro(r.erro); })}>
        {pendente ? 'Registrando…' : 'Estou ciente desta escala'}
      </Botao>
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </div>
  );
}
