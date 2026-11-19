import { notFound } from 'next/navigation';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
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
  // setores da empresa: servem para mostrar o nome do setor e para a lista do formulário de edição
  const { data: set } = await supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome');
  const setores = linhas<{ id: string; nome: string }>(set).map((x) => ({ id: x.id, nome: x.nome }));
  const setor = demanda.setor_id ? setores.find((x) => x.id === demanda.setor_id)?.nome ?? 'Setor' : null;
  return <TelaFaixa empresaId={empresaId} demanda={demanda} setor={setor} setores={setores} podeGerir={ger === true} />;
}
