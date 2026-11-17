'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { SeletorCbo } from '@/components/SeletorCbo';
import { Aviso, Botao, Campo, classeBotaoLink, classeCampo } from '@/components/ui';
import { CamposContrato } from '../CamposContrato';
import { cadastrarColaborador, type EstadoNovoColaborador } from '../actions';

const ESCOLARIDADES = [['', 'Não informar'], ['fundamental', 'Ensino fundamental'], ['medio', 'Ensino médio'], ['superior', 'Ensino superior'], ['pos', 'Pós-graduação']] as const;

export function FormNovoColaborador({ empresaId }: { empresaId: string }) {
  const [estado, acao, pendente] = useActionState<EstadoNovoColaborador, FormData>(cadastrarColaborador.bind(null, empresaId), {});
  const [cargo, setCargo] = useState(estado.valores?.cargo ?? '');
  const v = (c: string) => estado.valores?.[c] ?? '';
  const erro = (c: keyof NonNullable<EstadoNovoColaborador['erros']>) => (estado.erros?.[c] ? <span role="alert" className="mt-1 block text-xs text-risco-fg">{estado.erros[c]}</span> : null);
  const sec = 'text-xs font-bold uppercase tracking-wider text-suave sm:col-span-2 lg:col-span-3';
  return (
    <form action={acao} className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" noValidate>
      <p className={sec}>Pessoa</p>
      <Campo rotulo="Nome completo *"><input name="nome" required defaultValue={v('nome')} autoComplete="off" className={classeCampo} />{erro('nome')}</Campo>
      <Campo rotulo="CPF *"><input name="cpf" required inputMode="numeric" placeholder="000.000.000-00" defaultValue={v('cpf')} autoComplete="off" className={classeCampo} />{erro('cpf')}</Campo>
      <Campo rotulo="Data de admissão *"><input name="admissao" required placeholder="dd/mm/aaaa" defaultValue={v('admissao')} className={classeCampo} />{erro('admissao')}</Campo>
      <Campo rotulo="Matrícula"><input name="matricula" defaultValue={v('matricula')} className={classeCampo} />{erro('matricula')}</Campo>
      <Campo rotulo="Telefone / WhatsApp"><input name="telefone" inputMode="tel" defaultValue={v('telefone')} className={classeCampo} />{erro('telefone')}</Campo>
      <Campo rotulo="Escolaridade">
        <select name="escolaridade" defaultValue={v('escolaridade')} className={classeCampo}>{ESCOLARIDADES.map(([val, r]) => <option key={val} value={val}>{r}</option>)}</select>
      </Campo>

      <p className={`${sec} mt-2`}>Cargo e setor</p>
      <Campo rotulo="Ocupação (CBO)" dica="Opcional. Ao escolher, o cargo é preenchido se estiver vazio"><SeletorCbo valorInicial={v('cbo')} aoEscolher={(o) => setCargo((c) => c || o[1])} />{erro('cbo')}</Campo>
      <Campo rotulo="Cargo"><input name="cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} className={classeCampo} /></Campo>
      <Campo rotulo="Setor" dica="Se o setor ainda não existir, ele é criado"><input name="setor" defaultValue={v('setor')} className={classeCampo} />{erro('setor')}</Campo>

      <p className={`${sec} mt-2`}>Contrato e escala</p>
      <CamposContrato valores={estado.valores} erros={estado.erros} />

      <div className="flex flex-wrap items-center gap-2 pt-2 sm:col-span-2 lg:col-span-3">
        {estado.erroGeral ? <div className="w-full"><Aviso tipo="erro">{estado.erroGeral}</Aviso></div> : null}
        <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Cadastrar colaborador'}</Botao>
        <Link href={`/empresas/${empresaId}/colaboradores`} className={classeBotaoLink}>Cancelar</Link>
      </div>
    </form>
  );
}
