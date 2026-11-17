import { Cartao } from '@/components/ui';
import { horaDeMinutos } from '@/lib/adequador-ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { todasAsLinhas } from '@/lib/paginar';
import { dataDeInstante, parseDaterange, somarDias } from '@jc/rules-engine';
import { GerarEscala } from './Adequador';

type ModeloLinha = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number };
type Vig = { colaborador_id: string; nome: string; setor_id: string | null };

export default async function PaginaGerarEscala({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [mod, set, eq, aus, { data: ger }] = await Promise.all([
    supabase.from('turno_modelo').select('id, nome, inicio_min, fim_min, intervalo_min').eq('empresa_id', empresaId).eq('ativo', true).order('inicio_min'),
    supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome'),
    todasAsLinhas<Vig>((a, b) => supabase.from('vw_colaborador_vigente').select('colaborador_id, nome, setor_id').eq('empresa_id', empresaId).order('nome').range(a, b), { maximo: 5000 }),
    supabase.from('ausencia').select('colaborador_id, periodo, tipo').eq('empresa_id', empresaId).order('periodo', { ascending: false }).limit(600),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  if (ger !== true) return <Cartao titulo="Sem permissão">Só quem gere a empresa gera escalas automaticamente.</Cartao>;
  const hoje = dataDeInstante(new Date());
  const [a, m] = hoje.slice(0, 7).split('-').map(Number) as [number, number];
  const proximo = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  const modelos = linhas<ModeloLinha>(mod.data).map((x) => ({ id: x.id, nome: x.nome, inicio: horaDeMinutos(x.inicio_min), fim: horaDeMinutos(x.fim_min), intervalo: x.intervalo_min }));
  const pessoas = eq.linhas.map((p) => ({ id: p.colaborador_id, nome: p.nome, setorId: p.setor_id }));
  const setores = linhas<{ id: string; nome: string }>(set.data).map((s) => ({ id: s.id, nome: s.nome, pessoas: pessoas.filter((p) => p.setorId === s.id).map((p) => ({ id: p.id, nome: p.nome })) }));
  const ausencias = linhas<{ colaborador_id: string; periodo: string; tipo: 'ferias' | 'afastamento' }>(aus.data).flatMap((x) => {
    try { const v = parseDaterange(x.periodo); return v.inicio && v.fim ? [{ colaboradorId: x.colaborador_id, inicio: v.inicio, fim: somarDias(v.fim, -1), tipo: x.tipo }] : []; } catch { return []; }
  });
  return (
    <GerarEscala empresaId={empresaId} mesPadrao={proximo} modelos={modelos} setores={setores} semSetor={setores.length > 0 ? pessoas.filter((p) => !p.setorId).length : 0}
      todos={setores.length === 0 ? pessoas.map((p) => ({ id: p.id, nome: p.nome })) : []} ausencias={ausencias} />
  );
}
