import { CartaoEmpresa } from '@/components/CartaoEmpresa';
import { Cartao, Titulo } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import type { EmpresaRow, OrganizacaoRow } from '@/lib/tipos-db';
import { FormNovaEmpresa } from './FormNovaEmpresa';

export default async function Empresas() {
  const { supabase } = await exigirUsuario();
  const [{ data: emp }, { data: orgs }] = await Promise.all([
    supabase.from('empresa').select('id, razao_social, cnpj, porte, uf, status_adequacao').order('razao_social'),
    supabase.from('organizacao').select('id, nome, tipo').neq('tipo', 'plataforma').order('nome'),
  ]);
  const empresas = linhas<EmpresaRow>(emp);
  const organizacoes = linhas<OrganizacaoRow>(orgs);
  return (
    <>
      <Titulo descricao="Escolha uma empresa para ver o diagnóstico da nova escala 5x2 ou cadastre uma nova.">Suas empresas</Titulo>
      {empresas.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {empresas.map((e) => <li key={e.id} className="contents"><CartaoEmpresa empresa={e} /></li>)}
        </ul>
      ) : (
        <Cartao titulo="Vamos começar" subtitulo="Cadastre a primeira empresa. Em seguida você importa a planilha de colaboradores e recebe o diagnóstico em poucos minutos." children={null} />
      )}
      {organizacoes.length > 0 && <Cartao titulo="Cadastrar empresa"><FormNovaEmpresa organizacoes={organizacoes} /></Cartao>}
    </>
  );
}
