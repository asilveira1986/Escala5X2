'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Aviso, Botao, Campo, classeBotaoLink, classeCampo } from '@/components/ui';
import { cadastrarColaborador, type EstadoNovoColaborador } from '../actions';

const ESCOLARIDADES = [['', 'Não informar'], ['fundamental', 'Ensino fundamental'], ['medio', 'Ensino médio'], ['superior', 'Ensino superior'], ['pos', 'Pós-graduação']] as const;

export function FormNovoColaborador({ empresaId }: { empresaId: string }) {
  const [estado, acao, pendente] = useActionState<EstadoNovoColaborador, FormData>(cadastrarColaborador.bind(null, empresaId), {});
  const [tipo, setTipo] = useState(estado.valores?.tipo_escala ?? '5x2');
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
      <Campo rotulo="Cargo"><input name="cargo" defaultValue={v('cargo')} className={classeCampo} /></Campo>
      <Campo rotulo="CBO" dica="Opcional"><input name="cbo" inputMode="numeric" defaultValue={v('cbo')} className={classeCampo} /></Campo>
      <Campo rotulo="Setor" dica="Se o setor ainda não existir, ele é criado"><input name="setor" defaultValue={v('setor')} className={classeCampo} />{erro('setor')}</Campo>

      <p className={`${sec} mt-2`}>Contrato e escala</p>
      <Campo rotulo="Salário base (R$) *"><input name="salario" required inputMode="decimal" placeholder="2.500,00" defaultValue={v('salario')} className={classeCampo} />{erro('salario')}</Campo>
      <Campo rotulo="Jornada semanal (horas) *" dica="Ex.: 44 ou 40"><input name="jornada_semanal" required inputMode="decimal" defaultValue={v('jornada_semanal') || '44'} className={classeCampo} />{erro('jornada_semanal')}</Campo>
      <Campo rotulo="Tipo de escala *">
        <select name="tipo_escala" value={tipo} onChange={(e) => setTipo(e.target.value)} className={classeCampo}>
          <option value="5x2">5x2 (5 dias de trabalho, 2 de folga)</option><option value="6x1">6x1</option><option value="12x36">12x36</option><option value="personalizada">Personalizada</option>
        </select>
        {erro('tipo_escala')}
      </Campo>
      <Campo rotulo="Turno" dica="Ex.: Manhã, Noite"><input name="turno" defaultValue={v('turno')} className={classeCampo} /></Campo>
      <Campo rotulo="Divisor da hora" dica="Em branco: calculado pela jornada"><input name="divisor" inputMode="numeric" defaultValue={v('divisor')} className={classeCampo} />{erro('divisor')}</Campo>
      <Campo rotulo="Horas extras por mês" dica="Média habitual, em horas (opcional)"><input name="horas_extras_mensais" inputMode="decimal" defaultValue={v('horas_extras_mensais')} className={classeCampo} />{erro('horas_extras_mensais')}</Campo>
      {tipo === 'personalizada' ? <Campo rotulo="Folgas por semana"><input name="folgas_semana" inputMode="numeric" defaultValue={v('folgas_semana')} className={classeCampo} />{erro('folgas_semana')}</Campo> : null}

      <div className="flex flex-wrap items-center gap-2 pt-2 sm:col-span-2 lg:col-span-3">
        {estado.erroGeral ? <div className="w-full"><Aviso tipo="erro">{estado.erroGeral}</Aviso></div> : null}
        <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Cadastrar colaborador'}</Botao>
        <Link href={`/empresas/${empresaId}/colaboradores`} className={classeBotaoLink}>Cancelar</Link>
      </div>
    </form>
  );
}
