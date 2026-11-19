import { notFound } from 'next/navigation';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { ImportacaoRow } from '@/lib/tipos-db';
import { TelaImportacao } from '../TelaImportacao';

export default async function StatusImportacao({ params }: { params: Promise<{ id: string; importacaoId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id);
  const id = idOu404(p.importacaoId);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('importacao').select('id, status, criado_em, relatorio').eq('id', id).eq('empresa_id', empresaId).maybeSingle();
  const imp = linhas<ImportacaoRow>(data ? [data] : [])[0];
  if (!imp) notFound();
  return <TelaImportacao empresaId={empresaId} importacao={imp} />;
}
