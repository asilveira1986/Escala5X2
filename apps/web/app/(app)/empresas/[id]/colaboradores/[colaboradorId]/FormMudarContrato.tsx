'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { CamposContrato, type ErrosContrato } from '../CamposContrato';
import { mudarContrato, type EstadoEdicao } from '../actions';

export function FormMudarContrato({ empresaId, colaboradorId, valores, hoje, admissao }: { empresaId: string; colaboradorId: string; valores: Record<string, string>; hoje: string; admissao: string }) {
  const [estado, acao, pendente] = useActionState<EstadoEdicao, FormData>(mudarContrato.bind(null, empresaId, colaboradorId), {});
  return (
    <form action={acao} className="grid gap-x-4 gap-y-3 sm:grid-cols-2" noValidate>
      <Campo rotulo="Vale a partir de *" dica="O contrato anterior termina na véspera">
        <input type="date" name="a_partir_de" required min={admissao} defaultValue={estado.valores?.a_partir_de ?? hoje} className={classeCampo} />
        {estado.erros?.a_partir_de ? <span role="alert" className="mt-1 block text-xs text-risco-fg">{estado.erros.a_partir_de}</span> : null}
      </Campo>
      <div className="hidden sm:block" />
      <CamposContrato key={estado.valores ? 'erro' : 'ini'} valores={estado.valores ?? valores} erros={estado.erros as ErrosContrato | undefined} />
      <div className="flex flex-wrap items-center gap-3 border-t border-linha pt-4 sm:col-span-2">
        <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar mudança de contrato'}</Botao>
        {estado.ok ? <span role="status" className="text-sm font-semibold text-ok-fg">{estado.ok}</span> : null}
        {estado.erroGeral ? <div className="w-full"><Aviso tipo="erro">{estado.erroGeral}</Aviso></div> : null}
      </div>
    </form>
  );
}
