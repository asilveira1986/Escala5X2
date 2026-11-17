import { Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { horaDeMinutos } from '@/lib/adequador-ui';
import { dataDeInstante } from '@jc/rules-engine';
import { Adequador } from './Adequador';

type ModeloLinha = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number };

export default async function PaginaAdequador({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [mod, set, eq, { data: ger }] = await Promise.all([
    supabase.from('turno_modelo').select('id, nome, inicio_min, fim_min, intervalo_min').eq('empresa_id', empresaId).eq('ativo', true).order('inicio_min'),
    supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome'),
    supabase.from('vw_colaborador_vigente').select('colaborador_id', { count: 'exact', head: true }).eq('empresa_id', empresaId),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  if (ger !== true) return <Cartao titulo="Sem permissão">Só quem gere a empresa usa o adequador de escala.</Cartao>;
  const hoje = dataDeInstante(new Date());
  const [a, m] = hoje.slice(0, 7).split('-').map(Number) as [number, number];
  const proximo = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  const modelos = linhas<ModeloLinha>(mod.data).map((x) => ({ id: x.id, nome: x.nome, inicio: horaDeMinutos(x.inicio_min), fim: horaDeMinutos(x.fim_min), intervalo: x.intervalo_min }));
  return (
    <Adequador empresaId={empresaId} mesPadrao={proximo} equipe={eq.count ?? 0} modelos={modelos}
      setores={linhas<{ id: string; nome: string }>(set.data).map((s) => ({ id: s.id, nome: s.nome }))} />
  );
}
