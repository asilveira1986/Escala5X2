import { dataBr, type DataISO } from '@jc/rules-engine';
import type { Lancamento, OrigemLancamento } from '@jc/servicos';

/** 150 → "2h30"; 60 → "1h"; 45 → "45min"; negativo ganha sinal. */
export function horasTexto(min: number): string {
  const sinal = min < 0 ? '−' : '';
  const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  if (h === 0) return `${sinal}${m}min`;
  return `${sinal}${h}h${m ? String(m).padStart(2, '0') : ''}`;
}
export const saldoTexto = (min: number) => (min > 0 ? `+${horasTexto(min)}` : horasTexto(min));

export const ROTULO_ORIGEM: Record<OrigemLancamento, string> = {
  manual: 'Crédito', compensacao: 'Compensação', falta: 'Falta ou atraso', ajuste: 'Ajuste', pagamento: 'Pagamento de horas vencidas',
  estorno: 'Estorno', ponto: 'Ponto', escala: 'Escala',
};

/** Tipos que o RH pode lançar, com o sinal que o banco de dados exige para cada um. */
export const TIPOS_LANCAMENTO = [
  { id: 'manual', rotulo: 'Crédito (horas a favor do colaborador)', sinal: 1 },
  { id: 'compensacao', rotulo: 'Compensação (folga ou saída antecipada)', sinal: -1 },
  { id: 'falta', rotulo: 'Falta ou atraso a descontar do banco', sinal: -1 },
  { id: 'pagamento', rotulo: 'Pagamento de horas vencidas', sinal: -1 },
  { id: 'ajuste', rotulo: 'Ajuste (crédito)', sinal: 1 },
  { id: 'ajuste', rotulo: 'Ajuste (débito)', sinal: -1 },
] as const;

/** "02:30" → 150; vazio, mal formado ou 00:00 → null. */
export function lerDuracao(texto: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(texto.trim());
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min >= 1 && min <= 1440 ? min : null;
}
export const duracaoParaCampo = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Lançamentos já estornados (para esconder o botão) e estornos. */
export function estornados(ls: Lancamento[]): Set<number> {
  return new Set(ls.filter((l) => l.estorna_id != null).map((l) => l.estorna_id!));
}

export function descreverLancamento(l: Lancamento): string {
  const base = `${ROTULO_ORIGEM[l.origem]} de ${horasTexto(Math.abs(l.minutos))}`;
  return l.vence_em && l.minutos > 0 ? `${base} (vence em ${dataBr(l.vence_em as DataISO)})` : base;
}
