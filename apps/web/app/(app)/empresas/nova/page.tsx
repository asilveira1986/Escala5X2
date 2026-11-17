import { redirect } from 'next/navigation';
import { Cartao, Titulo } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import type { OrganizacaoRow } from '@/lib/tipos-db';
import { FormNovaEmpresa } from '../FormNovaEmpresa';

export default async function NovaEmpresa() {
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('organizacao').select('id, nome, tipo').neq('tipo', 'plataforma').order('nome');
  const organizacoes = linhas<OrganizacaoRow>(data);
  if (organizacoes.length === 0) redirect('/empresas'); // sem organização ainda: a tela de empresas pede para criar uma
  return (
    <>
      <Titulo icone="mais" descricao="Depois de cadastrar, importe a planilha de colaboradores para receber o diagnóstico.">Nova empresa</Titulo>
      <Cartao><FormNovaEmpresa organizacoes={organizacoes} /></Cartao>
    </>
  );
}
