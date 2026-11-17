import type { DataISO } from '@jc/rules-engine';
import { conciliarPonto, type MarcacaoPonto } from './conciliacao';
import type { EntradaEscala } from './escala-entrada';
import { chamar, type ClienteRpc } from './rpc';

export type ItemApuracao = {
  colaboradorId: string; nome: string; data: DataISO;
  /** Saldo do dia em minutos: positivo = horas a mais (crédito), negativo = horas a menos (débito). */
  minutos: number; previstoMin: number; efetivoMin: number;
  motivo: string;
  /** Já existe lançamento de ponto neste dia (não estornado): fica de fora do que se pode lançar. */
  jaLancado: boolean;
};

const MUDA_O_PREVISTO = new Set(['ATRASO', 'SAIDA_ANTECIPADA', 'HORA_EXTRA_REALIZADA', 'INTERVALO_REDUZIDO']);
const IGNORADOS = new Set(['SEM_MARCACAO', 'MARCACAO_IMPAR', 'MARCACAO_EM_AUSENCIA']);
const hm = (min: number) => `${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, '0')}`;

/**
 * Propõe lançamentos no banco de horas a partir do ponto: a diferença entre o que foi trabalhado (marcações) e o previsto na escala.
 * Só olha dias com marcação completa fora da tolerância da CLT (art. 58 §1º) e trabalho em dia de folga. Dia sem marcação,
 * com marcação incompleta ou em férias/afastamento NÃO gera nada (falta e abono são decisão da gestão). O servidor do banco
 * confere acordo, limites e prazo ao lançar; aqui só se propõe.
 */
export function apurarBancoPonto(entradas: EntradaEscala[], marcacoes: MarcacaoPonto[], periodo: { inicio: DataISO; fim: DataISO }, jaLancados: ReadonlySet<string> = new Set()): ItemApuracao[] {
  const { inicio, fim } = periodo;
  const noMes = (d: DataISO) => d >= inicio && d <= fim;
  const itens = new Map<string, ItemApuracao>();
  for (const e of entradas) {
    const nomes = new Map(e.colaboradores.map((c) => [c.colaboradorId, c.nome]));
    const dias = conciliarPonto({ ...e, escala: { ...e.escala, inicio: e.escala.inicio < inicio ? inicio : e.escala.inicio, fim: e.escala.fim > fim ? fim : e.escala.fim } }, marcacoes).dias;
    const previstos = e.alocacoes.filter((a) => a.tipo === 'trabalho' && a.inicioMin != null && a.fimMin != null && noMes(a.data)).sort((a, b) => a.inicioMin! - b.inicioMin!);
    const ordem = new Map<string, number>();
    const doTurno = new Map<string, (typeof previstos)[number]>();
    for (const a of previstos) { const k = `${a.colaboradorId}|${a.data}`; const i = ordem.get(k) ?? 0; ordem.set(k, i + 1); doTurno.set(`${k}|${i}`, a); }
    const visto = new Map<string, number>();
    for (const d of dias) {
      if (!noMes(d.data)) continue;
      const kd = `${d.colaboradorId}|${d.data}`;
      let alvo: { efetivo: number; previsto: number; motivo: string } | null = null;
      // férias/afastamento lançado cobre o dia: horas em ausência não viram saldo
      if (e.ausencias.some((x) => x.colaboradorId === d.colaboradorId && d.data >= x.inicio && d.data <= x.fim)) continue;
      if (d.previstoLiquidoMin > 0) {
        const i = visto.get(kd) ?? 0; visto.set(kd, i + 1);
        if (d.codigos.some((c) => IGNORADOS.has(c)) || !d.codigos.some((c) => MUDA_O_PREVISTO.has(c)) || d.entradaRealMin == null || d.saidaRealMin == null) continue;
        const a = doTurno.get(`${kd}|${i}`);
        const efetivo = (d.saidaRealMin - d.entradaRealMin) - (d.pausasRealMin > 0 ? d.pausasRealMin : (a ? (a.fimMin! - a.inicioMin! - d.previstoLiquidoMin) : 0));
        const partes: string[] = [];
        if (d.atrasoMin > 0) partes.push(`atraso de ${d.atrasoMin} min`);
        if (d.saidaAntecipadaMin > 0) partes.push(`saída ${d.saidaAntecipadaMin} min antes`);
        if (d.horaExtraMin > 0) partes.push(`${d.horaExtraMin} min além do turno`);
        if (d.codigos.includes('INTERVALO_REDUZIDO')) partes.push('intervalo menor que o previsto');
        alvo = { efetivo, previsto: d.previstoLiquidoMin, motivo: `Ponto: ${partes.join(', ') || 'diferença do previsto'}` };
      } else if (d.codigos.includes('MARCACAO_EM_FOLGA') && d.entradaRealMin != null && d.saidaRealMin != null) {
        alvo = { efetivo: (d.saidaRealMin - d.entradaRealMin) - d.pausasRealMin, previsto: 0, motivo: 'Ponto: trabalho em dia de folga' };
      }
      if (!alvo) continue;
      const minutos = Math.max(-1440, Math.min(1440, alvo.efetivo - alvo.previsto));
      if (minutos === 0 || itens.has(kd)) continue;
      itens.set(kd, { colaboradorId: d.colaboradorId, nome: nomes.get(d.colaboradorId) ?? '', data: d.data, minutos, previstoMin: alvo.previsto, efetivoMin: alvo.efetivo, motivo: `${alvo.motivo} (${minutos > 0 ? '+' : '−'}${hm(minutos)})`, jaLancado: jaLancados.has(kd) });
    }
  }
  return [...itens.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.data.localeCompare(b.data));
}

export type ResultadoLoteBanco = { lancados: number; recusados: { colaboradorId: string; data: string; motivo: string }[] };

/** Lança no banco de horas (origem "ponto"). O banco confere permissão, acordo, limites e prazo, e recusa item a item. */
export async function lancarBancoPonto(cliente: ClienteRpc, empresaId: string, itens: Pick<ItemApuracao, 'colaboradorId' | 'data' | 'minutos' | 'motivo'>[]): Promise<ResultadoLoteBanco> {
  const r = await chamar(cliente, 'lancar_banco_horas_ponto', { p_empresa: empresaId, p_itens: itens.map((i) => ({ colaboradorId: i.colaboradorId, data: i.data, minutos: i.minutos, descricao: i.motivo })) });
  const o = r as Partial<ResultadoLoteBanco> | null;
  return { lancados: Number(o?.lancados ?? 0), recusados: Array.isArray(o?.recusados) ? o!.recusados : [] };
}
