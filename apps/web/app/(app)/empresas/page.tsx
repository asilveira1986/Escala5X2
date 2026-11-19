import Link from 'next/link';
import { Cartao, classeBotaoLinkPrimario, Titulo } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import type { EmpresaRow, OrganizacaoRow } from '@/lib/tipos-db';
import { FormNovaOrganizacao } from './FormNovaOrganizacao';
import { TabelaEmpresas } from './TabelaEmpresas';

export default async function Empresas() {
  const { supabase, user } = await exigirUsuario();
  const nome = String((user.user_metadata as { nome?: string; full_name?: string } | undefined)?.nome ?? (user.user_metadata as { full_name?: string } | undefined)?.full_name ?? '').split(' ')[0];
  const [{ data: emp }, { data: orgs }] = await Promise.all([
    supabase.from('empresa').select('id, razao_social, cnpj, porte, uf, status_adequacao').order('razao_social'),
    supabase.from('organizacao').select('id, nome, tipo').neq('tipo', 'plataforma').order('nome'),
  ]);
  const empresas = linhas<EmpresaRow>(emp);
  const organizacoes = linhas<OrganizacaoRow>(orgs);
  if (organizacoes.length === 0 && empresas.length === 0) {
    return (
      <>
        <p className="-mb-1 text-sm font-semibold text-marca">{nome ? `Olá, ${nome}!` : 'Olá!'}</p>
        <Titulo descricao="Antes de cadastrar empresas, conte rapidamente quem você é. Leva menos de um minuto.">Bem-vindo ao JornadaCerta</Titulo>
        <Cartao titulo="Crie a sua organização"><FormNovaOrganizacao /></Cartao>
      </>
    );
  }
  return (
    <>
      {nome ? <p className="-mb-1 text-sm font-semibold text-marca">Olá, {nome}!</p> : <p className="-mb-1 text-sm font-semibold text-marca">Olá!</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Titulo icone="empresas" descricao="Escolha uma empresa para abrir o sistema dela." acoes={organizacoes.length > 0 ? <Link href="/empresas/nova" className={classeBotaoLinkPrimario}>Nova empresa</Link> : null}>Suas empresas</Titulo>
      </div>
      <Cartao icone="empresas" titulo={`${empresas.length} ${empresas.length === 1 ? 'empresa' : 'empresas'}`}>
        <TabelaEmpresas dados={empresas} />
      </Cartao>
    </>
  );
}
