'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { horaDeMinutos } from '@/lib/adequador-ui';
import { editarModelo } from '../../actions';

export type TurnoEdicao = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number };

/** Edição do turno na tela dele. Vale para as próximas escalas: o que já foi escalado não muda. */
export function FormEditarTurno({ empresaId, turno: t }: { empresaId: string; turno: TurnoEdicao }) {
  const [estado, acao, pendente] = useActionState(editarModelo, {});
  return (
    <form action={acao} className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <input type="hidden" name="empresaId" value={empresaId} />
      <input type="hidden" name="modeloId" value={t.id} />
      <Campo rotulo="Nome"><input name="nome" required maxLength={40} defaultValue={t.nome} className={classeCampo} /></Campo>
      <Campo rotulo="Intervalo (min)"><input type="number" name="intervalo" min={0} max={240} defaultValue={t.intervalo_min} className={classeCampo} /></Campo>
      <Campo rotulo="Entrada"><input type="time" name="inicio" defaultValue={horaDeMinutos(t.inicio_min)} required className={classeCampo} /></Campo>
      <Campo rotulo="Saída" dica="Antes da entrada = dia seguinte."><input type="time" name="fim" defaultValue={horaDeMinutos(t.fim_min)} required className={classeCampo} /></Campo>
      <p className="text-xs text-suave sm:col-span-2">A mudança vale para as próximas escalas e adequações. O que já foi escalado, inclusive escalas publicadas, não muda.</p>
      <div className="flex flex-wrap items-center gap-3 border-t border-linha pt-4 sm:col-span-2">
        <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar turno'}</Botao>
        {estado.ok ? <span role="status" className="text-sm font-semibold text-ok-fg">Turno salvo.</span> : null}
        {estado.erro ? <div className="w-full"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
      </div>
    </form>
  );
}
