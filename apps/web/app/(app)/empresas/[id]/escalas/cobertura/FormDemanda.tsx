'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { DIAS_SEMANA } from '@/lib/cobertura';
import { adicionarDemanda, type EstadoForm } from './actions';

export function FormDemanda({ empresaId, setores }: { empresaId: string; setores: Array<{ id: string; nome: string }> }) {
  const [estado, acao, pendente] = useActionState<EstadoForm, FormData>(adicionarDemanda, {});
  return (
    <form action={acao} className="space-y-3">
      <input type="hidden" name="empresaId" value={empresaId} />
      <fieldset>
        <legend className="text-sm font-semibold">Dias da semana</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {DIAS_SEMANA.map((d) => (
            <label key={d.n} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-linha bg-cartao px-3 text-sm font-semibold has-[:checked]:border-marca has-[:checked]:bg-marca-suave sm:min-h-9">
              <input type="checkbox" name="dias" value={d.n} defaultChecked={d.n >= 1 && d.n <= 5} className="size-4" />{d.curto}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Das"><input type="time" name="inicio" defaultValue="08:00" required className={classeCampo} /></Campo>
        <Campo rotulo="Até" dica="00:00 = fim do dia; menor que o início = vira o dia."><input type="time" name="fim" defaultValue="12:00" required className={classeCampo} /></Campo>
        <Campo rotulo="Mínimo de pessoas"><input type="number" name="minimo" min={0} defaultValue={2} required className={`${classeCampo} sm:w-28`} /></Campo>
        <Campo rotulo="Ideal (opcional)"><input type="number" name="ideal" min={0} className={`${classeCampo} sm:w-28`} /></Campo>
        {setores.length > 0 ? (
          <Campo rotulo="Setor" dica="Em branco: vale para a empresa toda.">
            <select name="setorId" defaultValue="" className={classeCampo}>
              <option value="">Empresa toda</option>
              {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Campo>
        ) : null}
        <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Adicionar faixa'}</Botao>
      </div>
      {estado.erro ? <Aviso tipo="erro">{estado.erro}</Aviso> : null}
      {estado.ok ? <Aviso tipo="ok">{estado.ok}</Aviso> : null}
    </form>
  );
}
