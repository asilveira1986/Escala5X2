'use client';

import { useActionState, useState } from 'react';
import { SeletorCbo } from '@/components/SeletorCbo';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { atualizarDadosColaborador, type EstadoEdicao } from '../actions';

const ESCOLARIDADES = [['', 'Não informar'], ['fundamental', 'Ensino fundamental'], ['medio', 'Ensino médio'], ['superior', 'Ensino superior'], ['pos', 'Pós-graduação']] as const;

export function FormEditarPessoa({ empresaId, colaboradorId, valores, cpfMascarado }: { empresaId: string; colaboradorId: string; valores: Record<string, string>; cpfMascarado: string }) {
  const [estado, acao, pendente] = useActionState<EstadoEdicao, FormData>(atualizarDadosColaborador.bind(null, empresaId, colaboradorId), {});
  const v = (c: string) => estado.valores?.[c] ?? valores[c] ?? '';
  const [cargo, setCargo] = useState(v('cargo'));
  const erro = (c: string) => (estado.erros?.[c] ? <span role="alert" className="mt-1 block text-xs text-risco-fg">{estado.erros[c]}</span> : null);
  return (
    <form action={acao} className="space-y-5" noValidate>
      <fieldset className="space-y-3">
        <legend className="rotulo-col mb-1">Identificação</legend>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Campo rotulo="Nome completo *"><input name="nome" required defaultValue={v('nome')} autoComplete="off" className={classeCampo} />{erro('nome')}</Campo>
          <Campo rotulo="CPF" dica="O CPF não pode ser alterado"><input value={cpfMascarado} disabled readOnly className={`${classeCampo} bg-fundo`} /></Campo>
          <Campo rotulo="Telefone / WhatsApp"><input name="telefone" inputMode="tel" defaultValue={v('telefone')} className={classeCampo} />{erro('telefone')}</Campo>
          <Campo rotulo="Escolaridade">
            <select name="escolaridade" defaultValue={v('escolaridade')} className={classeCampo}>{ESCOLARIDADES.map(([val, r]) => <option key={val} value={val}>{r}</option>)}</select>
            {erro('escolaridade')}
          </Campo>
        </div>
      </fieldset>
      <fieldset className="space-y-3 border-t border-linha pt-4">
        <legend className="rotulo-col mb-1">Trabalho</legend>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Campo rotulo="Setor" dica="Se o setor ainda não existir, ele é criado"><input name="setor" defaultValue={v('setor')} className={classeCampo} /></Campo>
          <Campo rotulo="Matrícula"><input name="matricula" defaultValue={v('matricula')} className={classeCampo} /></Campo>
          <Campo rotulo="Ocupação (CBO)" dica="Opcional"><SeletorCbo valorInicial={v('cbo')} aoEscolher={(o) => setCargo((c) => c || o[1])} />{erro('cbo')}</Campo>
          <Campo rotulo="Cargo"><input name="cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} className={classeCampo} /></Campo>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 border-t border-linha pt-4">
        <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar dados'}</Botao>
        {estado.ok ? <span role="status" className="text-sm font-semibold text-ok-fg">{estado.ok}</span> : null}
        {estado.erroGeral ? <div className="w-full"><Aviso tipo="erro">{estado.erroGeral}</Aviso></div> : null}
      </div>
    </form>
  );
}
