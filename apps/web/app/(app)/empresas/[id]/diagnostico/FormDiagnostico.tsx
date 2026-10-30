'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { rodarDiagnostico, type EstadoDiagnostico } from './actions';

export function FormDiagnostico({ empresaId, hoje }: { empresaId: string; hoje: string }) {
  const [estado, acao, pendente] = useActionState<EstadoDiagnostico, FormData>(rodarDiagnostico, {});
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="empresaId" value={empresaId} />
      <Campo rotulo="Data de referência"><input type="date" name="dataReferencia" defaultValue={hoje} required className={classeCampo} /></Campo>
      <Botao disabled={pendente}>{pendente ? 'Calculando…' : 'Rodar diagnóstico'}</Botao>
      {estado.erro ? <div className="basis-full"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
    </form>
  );
}
