'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { criarEscala, type EstadoForm } from './actions';

export function FormNovaEscala({ empresaId, mesPadrao, setores }: { empresaId: string; mesPadrao: string; setores: Array<{ id: string; nome: string }> }) {
  const [estado, acao, pendente] = useActionState<EstadoForm, FormData>(criarEscala, {});
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="empresaId" value={empresaId} />
      <Campo rotulo="Nome"><input name="nome" required maxLength={80} placeholder="Ex.: Escala de março" className={classeCampo} /></Campo>
      <Campo rotulo="Mês"><input type="month" name="mes" defaultValue={mesPadrao} required className={classeCampo} /></Campo>
      {setores.length > 0 ? (
        <Campo rotulo="Setor" dica="Em branco: a empresa toda.">
          <select name="setorId" defaultValue="" className={classeCampo}>
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </Campo>
      ) : null}
      <Botao disabled={pendente}>{pendente ? 'Criando…' : 'Criar escala'}</Botao>
      {estado.erro ? <div className="basis-full"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
    </form>
  );
}
