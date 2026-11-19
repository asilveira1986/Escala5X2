import { notFound } from 'next/navigation';
import { exigirUsuario, idOu404 } from '@/lib/contexto';
import { lerDaterange } from '@/lib/cobertura';
import { situacaoAusencia } from '@/lib/ausencias';
import { dataDeInstante } from '@jc/rules-engine';
import { TelaAusencia } from './TelaAusencia';

export default async function PaginaAusencia({ params }: { params: Promise<{ id: string; ausenciaId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), ausenciaId = idOu404(p.ausenciaId);
  const { supabase } = await exigirUsuario();
  const [{ data }, { data: ger }] = await Promise.all([
    supabase.from('ausencia').select('id, colaborador_id, periodo, tipo, observacao').eq('id', ausenciaId).eq('empresa_id', empresaId).maybeSingle(),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const a = data as { id: string; colaborador_id: string; periodo: string; tipo: 'ferias' | 'afastamento'; observacao: string | null } | null;
  const per = a ? lerDaterange(a.periodo) : null;
  if (!a || !per) notFound();
  const { data: c } = await supabase.from('colaborador').select('nome').eq('id', a.colaborador_id).maybeSingle();
  const hoje = dataDeInstante(new Date());
  return <TelaAusencia empresaId={empresaId} podeGerir={ger === true}
    ausencia={{ id: a.id, pessoa: (c as { nome: string } | null)?.nome ?? 'Colaborador', tipo: a.tipo, inicio: per.inicio, fim: per.fim, observacao: a.observacao, situacao: situacaoAusencia(per.inicio, per.fim, hoje) }} />;
}
