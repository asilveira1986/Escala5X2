'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { criarModelo, type EstadoForm } from './actions';

export function FormModeloTurno({ empresaId }: { empresaId: string }) {
  const [estado, acao, pendente] = useActionState<EstadoForm, FormData>(criarModelo, {});
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="empresaId" value={empresaId} />
      <Campo rotulo="Nome"><input name="nome" required maxLength={40} placeholder="Ex.: Manhã" className={`${classeCampo} sm:w-36`} /></Campo>
      <Campo rotulo="Entrada"><input type="time" name="inicio" defaultValue="08:00" required className={classeCampo} /></Campo>
      <Campo rotulo="Saída" dica="Antes da entrada = dia seguinte."><input type="time" name="fim" defaultValue="17:00" required className={classeCampo} /></Campo>
      <Campo rotulo="Intervalo (min)"><input type="number" name="intervalo" min={0} max={240} defaultValue={60} className={`${classeCampo} sm:w-28`} /></Campo>
      <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Adicionar turno'}</Botao>
      {estado.erro ? <div className="basis-full"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
    </form>
  );
}
