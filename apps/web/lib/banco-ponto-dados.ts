import { dataDoNumero, numeroDoDia } from '@jc/rules-engine';
import { apurarBancoPonto, carregarEntradaEscala, type ClienteRpc, type EntradaEscala, type ItemApuracao } from '@jc/servicos';
import { carregarMarcacoes } from './folha-dados';
import { todasAsLinhas } from './paginar';

type Cliente = ClienteRpc & { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- cliente do Supabase sem tipos gerados

export type Apuracao = { inicio: string; fim: string; itens: ItemApuracao[]; temEscala: boolean; temMarcacoes: boolean; completo: boolean };

/** Primeiro e último dia do mês AAAA-MM. */
export function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const inicio = `${mes}-01`;
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const prox = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1));
  return { inicio, fim: dataDoNumero(numeroDoDia(prox.toISOString().slice(0, 10)) - 1) };
}

/** Lê escalas publicadas, marcações e lançamentos de ponto já feitos, e propõe o que lançar no banco de horas. */
export async function calcularApuracao(supabase: Cliente, empresaId: string, mes: string): Promise<Apuracao> {
  const { inicio, fim } = limitesDoMes(mes);
  const { data: ids } = await supabase.rpc('escalas_publicadas_no_periodo', { p_empresa: empresaId, p_inicio: inicio, p_fim: fim });
  const entradas: EntradaEscala[] = [];
  for (const id of Array.isArray(ids) ? (ids as string[]) : []) entradas.push(await carregarEntradaEscala(supabase, id));
  const m = entradas.length > 0 ? await carregarMarcacoes(supabase, empresaId, inicio, fim) : { marcacoes: [], completo: true };
  const lan = await todasAsLinhas<{ id: number; colaborador_id: string; data: string; origem: string; estorna_id: number | null }>((a, b) =>
    supabase.from('banco_horas_lancamento').select('id, colaborador_id, data, origem, estorna_id').eq('empresa_id', empresaId).in('origem', ['ponto', 'estorno']).order('id').range(a, b));
  const estornados = new Set(lan.linhas.filter((l) => l.estorna_id != null).map((l) => l.estorna_id));
  const jaLancados = new Set(lan.linhas.filter((l) => l.origem === 'ponto' && !estornados.has(l.id)).map((l) => `${l.colaborador_id}|${l.data}`));
  const itens = apurarBancoPonto(entradas, m.marcacoes, { inicio, fim }, jaLancados);
  return { inicio, fim, itens, temEscala: entradas.length > 0, temMarcacoes: m.marcacoes.length > 0, completo: m.completo && !lan.erro && !lan.truncado };
}
