'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import type { DataISO } from '@jc/rules-engine';
import { editarAusencia, type EstadoForm } from '../actions';

export type AusenciaEdicao = { id: string; tipo: 'ferias' | 'afastamento'; inicio: DataISO; fim: DataISO; observacao: string | null };

/** Edição do lançamento na tela dele: tipo, período e observação (a pessoa não muda). */
export function FormEditarAusencia({ empresaId, ausencia: a }: { empresaId: string; ausencia: AusenciaEdicao }) {
  const [estado, acao, pendente] = useActionState<EstadoForm, FormData>(editarAusencia, {});
  return (
    <form action={acao} className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <input type="hidden" name="empresaId" value={empresaId} />
      <input type="hidden" name="ausenciaId" value={a.id} />
      <Campo rotulo="Tipo">
        <select name="tipo" defaultValue={a.tipo} className={classeCampo}><option value="ferias">Férias</option><option value="afastamento">Afastamento</option></select>
      </Campo>
      <Campo rotulo="Observação (opcional)"><input name="observacao" maxLength={200} defaultValue={a.observacao ?? ''} className={classeCampo} /></Campo>
      <Campo rotulo="Primeiro dia"><input type="date" name="inicio" required defaultValue={a.inicio} className={classeCampo} /></Campo>
      <Campo rotulo="Último dia" dica="Inclusive."><input type="date" name="fim" required defaultValue={a.fim} className={classeCampo} /></Campo>
      <div className="flex flex-wrap items-center gap-3 border-t border-linha pt-4 sm:col-span-2">
        <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar lançamento'}</Botao>
        {estado.ok ? <span role="status" className="text-sm font-semibold text-ok-fg">{estado.ok}</span> : null}
        {estado.erro ? <div className="w-full"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
      </div>
    </form>
  );
}
