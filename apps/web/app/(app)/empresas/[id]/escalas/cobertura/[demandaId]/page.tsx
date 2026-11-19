import { notFound } from 'next/navigation';
import { exigirUsuario, idOu404 } from '@/lib/contexto';
import type { Demanda } from '@/lib/cobertura';
import { TelaFaixa } from './TelaFaixa';

export default async function PaginaFaixa({ params }: { params: Promise<{ id: string; demandaId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), demandaId = idOu404(p.demandaId);
  const { supabase } = await exigirUsuario();
  const [{ data }, { data: ger }] = await Promise.all([
    supabase.from('demanda_cobertura').select('id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal').eq('id', demandaId).eq('empresa_id', empresaId).maybeSingle(),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const demanda = data as Demanda | null;
  if (!demanda) notFound();
  let setor: string | null = null;
  if (demanda.setor_id) {
    const { data: s } = await supabase.from('setor').select('nome').eq('id', demanda.setor_id).maybeSingle();
    setor = (s as { nome: string } | null)?.nome ?? 'Setor';
  }
  return <TelaFaixa empresaId={empresaId} demanda={demanda} setor={setor} podeGerir={ger === true} />;
}
