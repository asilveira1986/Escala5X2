'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { adicionarAusencia, type EstadoForm } from './actions';

export function FormAusencia({ empresaId, colaboradores }: { empresaId: string; colaboradores: Array<{ id: string; nome: string }> }) {
  const [estado, acao, pendente] = useActionState<EstadoForm, FormData>(adicionarAusencia, {});
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="empresaId" value={empresaId} />
      <Campo rotulo="Colaborador">
        <select name="colaboradorId" required defaultValue="" className={`${classeCampo} sm:w-56`}>
          <option value="" disabled>Escolha…</option>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Tipo">
        <select name="tipo" defaultValue="ferias" className={classeCampo}><option value="ferias">Férias</option><option value="afastamento">Afastamento</option></select>
      </Campo>
      <Campo rotulo="Primeiro dia"><input type="date" name="inicio" required className={classeCampo} /></Campo>
      <Campo rotulo="Último dia" dica="Inclusive."><input type="date" name="fim" required className={classeCampo} /></Campo>
      <Campo rotulo="Observação (opcional)"><input name="observacao" maxLength={200} className={`${classeCampo} sm:w-52`} /></Campo>
      <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Lançar ausência'}</Botao>
      {estado.erro ? <div className="basis-full"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
      {estado.ok ? <div className="basis-full"><Aviso tipo="ok">{estado.ok}</Aviso></div> : null}
    </form>
  );
}
