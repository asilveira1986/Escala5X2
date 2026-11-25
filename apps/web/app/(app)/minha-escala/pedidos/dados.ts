import { exigirUsuario, linhas } from '@/lib/contexto';
import { agruparPorEscala, textoTurno, type LinhaMinhaEscala } from '@/lib/minha-escala';
import type { TurnoColega } from '@/lib/solicitacoes-ui';
import { dataBr, dataDeInstante, diaDaSemana } from '@jc/rules-engine';
import type { EscalaParaPedido } from './FormPedido';

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Escalas publicadas com dias futuros da própria pessoa, já no formato do formulário de pedido (dias de trabalho, de folga e colegas). */
export async function escalasParaPedido(supabase: Awaited<ReturnType<typeof exigirUsuario>>['supabase'], meusIds: string[]): Promise<{ hoje: string; escalas: EscalaParaPedido[] }> {
  const hoje = dataDeInstante(new Date());
  const { data: aloc } = await supabase.from('alocacao')
    .select('escala_id, data, tipo, inicio_min, fim_min, intervalo_min, escala!inner(id, nome, periodo, versao, publicada_em, hash_publicado, status)')
    .in('colaborador_id', meusIds).eq('escala.status', 'publicada').gte('data', hoje).order('data');
  const escalas = agruparPorEscala(linhas<LinhaMinhaEscala>(aloc), []);
  const meus = new Set(meusIds);
  const paraForm = await Promise.all(escalas.map(async (e) => {
    const rotulo = (d: { data: string; tipo: string; inicioMin: number | null; fimMin: number | null; intervaloMin: number }) =>
      `${DIAS[diaDaSemana(d.data)]}, ${dataBr(d.data)} · ${textoTurno({ tipo: d.tipo as never, inicioMin: d.inicioMin, fimMin: d.fimMin, intervaloMin: d.intervaloMin })}`;
    const { data: col } = await supabase.rpc('escala_colegas', { p_escala: e.id });
    return {
      id: e.id, nome: `${e.nome} (versão ${e.versao})`,
      diasTrabalho: e.dias.filter((d) => d.tipo === 'trabalho').map((d) => ({ data: d.data, rotulo: rotulo(d) })),
      diasFolga: e.dias.filter((d) => d.tipo === 'folga' || d.tipo === 'dsr').map((d) => ({ data: d.data, rotulo: rotulo(d) })),
      colegas: linhas<TurnoColega>(col).filter((c) => !meus.has(c.colaborador_id)),
    };
  }));
  return { hoje, escalas: paraForm };
}
