import { notFound } from 'next/navigation';
import { exigirUsuario, idOu404 } from '@/lib/contexto';
import { TelaTurno } from './TelaTurno';
import type { TurnoEdicao } from './FormEditarTurno';

export default async function PaginaTurno({ params }: { params: Promise<{ id: string; turnoId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), turnoId = idOu404(p.turnoId);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('turno_modelo').select('id, nome, inicio_min, fim_min, intervalo_min').eq('id', turnoId).eq('empresa_id', empresaId).eq('ativo', true).maybeSingle();
  const turno = data as TurnoEdicao | null;
  if (!turno) notFound();
  return <TelaTurno empresaId={empresaId} turno={turno} />;
}
