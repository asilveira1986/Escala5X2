import { notFound } from 'next/navigation';
import type { SolicitacaoLinha } from '@jc/servicos';
import { exigirUsuario, idOu404 } from '@/lib/contexto';
import { prever } from '../previsao';
import { TelaPedido } from '../TelaPedido';

export default async function PaginaPedido({ params }: { params: Promise<{ id: string; pedidoId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), pedidoId = idOu404(p.pedidoId);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('solicitacao').select('*').eq('id', pedidoId).eq('empresa_id', empresaId).maybeSingle();
  const s = data as SolicitacaoLinha | null;
  if (!s) notFound();
  // a conferência das regras só é feita para o que ainda pode ser decidido
  const previsao = s.status === 'pendente' ? await prever(supabase, s) : null;
  return <TelaPedido s={s} empresaId={empresaId} previsao={previsao} />;
}
