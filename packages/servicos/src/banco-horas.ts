import { dataDoNumero, numeroDoDia, type DataISO } from '@jc/rules-engine';

export type OrigemLancamento = 'manual' | 'compensacao' | 'falta' | 'ajuste' | 'pagamento' | 'estorno' | 'ponto' | 'escala';
/** Linha de `banco_horas_lancamento`. */
export type Lancamento = {
  id: number; colaborador_id: string; data: DataISO; minutos: number; origem: OrigemLancamento; descricao: string | null;
  vence_em: DataISO | null; estorna_id: number | null; criado_em: string;
};
export type Lote = { venceEm: DataISO; minutos: number };
export type SaldoBanco = {
  /** Soma de tudo (positivo = a favor do colaborador). */
  saldoMin: number;
  /** Créditos que ainda não foram compensados, por vencimento. */
  lotes: Lote[];
  /** Créditos com prazo vencido e não compensados: devem ser pagos como hora extra. */
  vencidoMin: number;
  /** Créditos que vencem nos próximos dias (janela configurável). */
  aVencerMin: number;
  proximoVencimento: Lote | null;
  /** Débitos que passaram do saldo disponível (saldo negativo permitido pelo acordo). */
  negativoMin: number;
};

const somarDias = (d: DataISO, n: number): DataISO => dataDoNumero(numeroDoDia(d) + n);

/**
 * Consome os créditos do mais próximo de vencer para o mais distante (FIFO por vencimento), na ordem dos lançamentos.
 *  - Débito comum só consome crédito que ainda não tinha vencido NA DATA do débito: o vencido continua pendente de pagamento.
 *  - Pagamento consome qualquer crédito, começando pelos vencidos.
 *  - Débito acima do crédito disponível vira saldo negativo, coberto pelos próximos créditos.
 */
export function calcularSaldo(lancamentos: Lancamento[], hoje: DataISO, janelaDias = 30): SaldoBanco {
  const ordenados = [...lancamentos].sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
  let lotes: Lote[] = [];
  let negativo = 0;
  for (const l of ordenados) {
    if (l.minutos > 0) {
      let m = l.minutos;
      if (negativo > 0) { const cobre = Math.min(negativo, m); negativo -= cobre; m -= cobre; }
      if (m > 0) lotes.push({ venceEm: l.vence_em ?? somarDias(l.data, 180), minutos: m });
    } else {
      let falta = -l.minutos;
      const elegiveis = (x: Lote) => l.origem === 'pagamento' || x.venceEm >= l.data;
      lotes.sort((a, b) => a.venceEm.localeCompare(b.venceEm));
      for (const lote of lotes) {
        if (falta === 0) break;
        if (!elegiveis(lote)) continue;
        const usa = Math.min(lote.minutos, falta);
        lote.minutos -= usa; falta -= usa;
      }
      lotes = lotes.filter((x) => x.minutos > 0);
      negativo += falta;
    }
  }
  lotes.sort((a, b) => a.venceEm.localeCompare(b.venceEm));
  const limite = somarDias(hoje, janelaDias);
  const vencidos = lotes.filter((x) => x.venceEm < hoje);
  const aVencer = lotes.filter((x) => x.venceEm >= hoje && x.venceEm <= limite);
  return {
    saldoMin: ordenados.reduce((s, l) => s + l.minutos, 0), lotes,
    vencidoMin: vencidos.reduce((s, x) => s + x.minutos, 0), aVencerMin: aVencer.reduce((s, x) => s + x.minutos, 0),
    proximoVencimento: lotes.find((x) => x.venceEm >= hoje) ?? null, negativoMin: negativo,
  };
}

/** Estimativa do que pagar pelo crédito vencido: horas × valor da hora × (1 + adicional de hora extra). Em centavos. */
export function valorEstimadoVencido(vencidoMin: number, valorHoraCentavos: number, adicionalHePercentual: number): number {
  return Math.round((vencidoMin / 60) * valorHoraCentavos * (1 + adicionalHePercentual / 100));
}

export type ParametrosBanco = { prazoMeses: number; limiteSaldoMin: number | null; limiteNegativoMin: number };
/** Lê os parâmetros da cláusula `banco_horas` (resultado de RegrasEfetivas.bancoHoras) com os mesmos padrões do banco de dados. */
export function lerParametrosBanco(p: Record<string, unknown> | undefined): ParametrosBanco | null {
  if (!p) return null;
  const n = (k: string): number | null => (typeof p[k] === 'number' && Number.isFinite(p[k] as number) ? (p[k] as number) : null);
  return { prazoMeses: n('prazo_meses') ?? 6, limiteSaldoMin: n('limite_saldo_min'), limiteNegativoMin: n('limite_negativo_min') ?? 0 };
}
