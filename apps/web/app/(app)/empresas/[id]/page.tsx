import { notFound } from 'next/navigation';
import { VisaoGeral } from '@/components/VisaoGeral';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { EmpresaRow } from '@/lib/tipos-db';

export default async function PaginaVisaoGeral({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const cont = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [{ data }, colab, turnos, publicadas, rascunhos, pendentes] = await Promise.all([
    supabase.from('empresa').select('id, razao_social, cnpj, status_adequacao').eq('id', empresaId).maybeSingle(),
    cont(supabase.from('colaborador').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).is('desligamento', null)),
    cont(supabase.from('turno_modelo').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('ativo', true)),
    cont(supabase.from('escala').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'publicada')),
    cont(supabase.from('escala').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'rascunho')),
    cont(supabase.from('solicitacao').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'pendente')),
  ]);
  const empresa = linhas<EmpresaRow>(data ? [data] : [])[0];
  if (!empresa) notFound();
  return <VisaoGeral empresaId={empresaId} empresa={empresa} resumo={{ colab, turnos, publicadas, rascunhos, pendentes }} />;
}
