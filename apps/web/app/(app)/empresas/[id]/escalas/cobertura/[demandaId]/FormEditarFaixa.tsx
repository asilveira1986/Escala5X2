'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { horaDeMinutos } from '@/lib/adequador-ui';
import { DIAS_SEMANA, type Demanda } from '@/lib/cobertura';
import { editarDemanda, type EstadoForm } from '../actions';

/** Edição da faixa na tela dela: dia, horário, mínimo, ideal e setor. */
export function FormEditarFaixa({ empresaId, demanda: d, setores }: { empresaId: string; demanda: Demanda; setores: Array<{ id: string; nome: string }> }) {
  const [estado, acao, pendente] = useActionState<EstadoForm, FormData>(editarDemanda, {});
  return (
    <form action={acao} className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <input type="hidden" name="empresaId" value={empresaId} />
      <input type="hidden" name="demandaId" value={d.id} />
      <Campo rotulo="Dia da semana">
        <select name="dia" defaultValue={String(d.dia_semana)} className={classeCampo}>{DIAS_SEMANA.map((x) => <option key={x.n} value={x.n}>{x.longo}</option>)}</select>
      </Campo>
      <Campo rotulo="Setor" dica="Em branco: vale para a empresa toda.">
        <select name="setorId" defaultValue={d.setor_id ?? ''} className={classeCampo}>
          <option value="">Empresa toda</option>
          {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Das"><input type="time" name="inicio" required defaultValue={horaDeMinutos(d.faixa_inicio_min)} className={classeCampo} /></Campo>
      <Campo rotulo="Até" dica="00:00 = fim do dia; menor que o início = vira o dia."><input type="time" name="fim" required defaultValue={horaDeMinutos(d.faixa_fim_min)} className={classeCampo} /></Campo>
      <Campo rotulo="Mínimo de pessoas"><input type="number" name="minimo" min={0} required defaultValue={d.minimo} className={classeCampo} /></Campo>
      <Campo rotulo="Ideal (opcional)"><input type="number" name="ideal" min={0} defaultValue={d.ideal ?? ''} className={classeCampo} /></Campo>
      <div className="flex flex-wrap items-center gap-3 border-t border-linha pt-4 sm:col-span-2">
        <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar faixa'}</Botao>
        {estado.ok ? <span role="status" className="text-sm font-semibold text-ok-fg">{estado.ok}</span> : null}
        {estado.erro ? <div className="w-full"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
      </div>
    </form>
  );
}
