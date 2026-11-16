import { dataDoNumero, hhmm, numeroDoDia, type DataISO } from '@jc/rules-engine';

export const DIAS_SEMANA = [
  { n: 1, curto: 'seg', longo: 'Segunda' }, { n: 2, curto: 'ter', longo: 'Terça' }, { n: 3, curto: 'qua', longo: 'Quarta' },
  { n: 4, curto: 'qui', longo: 'Quinta' }, { n: 5, curto: 'sex', longo: 'Sexta' }, { n: 6, curto: 'sáb', longo: 'Sábado' }, { n: 0, curto: 'dom', longo: 'Domingo' },
] as const;

export type Demanda = { id: string; setor_id: string | null; dia_semana: number; faixa_inicio_min: number; faixa_fim_min: number; minimo: number; ideal: number | null };

/** "HH:MM" → minutos; null se inválido. */
export function lerHora(t: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export type Faixa = { inicioMin: number; fimMin: number };
/**
 * Converte entrada e saída em faixa. Saída 00:00 vale como o fim do dia (24:00); saída menor que a entrada
 * atravessa a meia-noite (o motor entende `faixaFimMin <= faixaInicioMin` assim).
 */
export function montarFaixa(inicio: string, fim: string): Faixa | null {
  const i = lerHora(inicio), f = lerHora(fim);
  if (i == null || f == null) return null;
  const fimMin = f === 0 ? 1440 : f;
  return fimMin === i ? null : { inicioMin: i, fimMin };
}

export const cruzaMeiaNoite = (d: Pick<Demanda, 'faixa_inicio_min' | 'faixa_fim_min'>) => d.faixa_fim_min <= d.faixa_inicio_min;

export function rotuloFaixa(d: Pick<Demanda, 'faixa_inicio_min' | 'faixa_fim_min'>): string {
  const fim = d.faixa_fim_min === 1440 ? '24:00' : hhmm(d.faixa_fim_min);
  return `${hhmm(d.faixa_inicio_min)}–${fim}${cruzaMeiaNoite(d) ? ' (dia seguinte)' : ''}`;
}

/** Agrupa por dia da semana na ordem seg…dom, faixas em ordem de horário. */
export function agruparPorDia(demandas: Demanda[]): Array<{ dia: (typeof DIAS_SEMANA)[number]; itens: Demanda[] }> {
  return DIAS_SEMANA.map((dia) => ({
    dia, itens: demandas.filter((d) => d.dia_semana === dia.n).sort((a, b) => a.faixa_inicio_min - b.faixa_inicio_min || a.faixa_fim_min - b.faixa_fim_min),
  })).filter((g) => g.itens.length > 0);
}

/** Valida mínimo/ideal vindos do formulário. */
export function lerQuantidades(minimo: unknown, ideal: unknown): { minimo: number; ideal: number | null } | string {
  const m = Number(minimo);
  if (minimo === '' || minimo == null || !Number.isInteger(m) || m < 0 || m > 10000) return 'Informe quantas pessoas são necessárias no mínimo.';
  if (ideal === '' || ideal == null) return { minimo: m, ideal: null };
  const i = Number(ideal);
  if (!Number.isInteger(i) || i < m) return 'O número ideal não pode ser menor que o mínimo.';
  return { minimo: m, ideal: i };
}

/** Período de ausência com fim inclusivo (como o usuário digita) → daterange com fim exclusivo. */
export function periodoAusencia(inicio: string, fim: string): { texto: string } | string {
  const ok = /^\d{4}-\d{2}-\d{2}$/;
  if (!ok.test(inicio) || !ok.test(fim)) return 'Informe as datas de início e de fim.';
  if (fim < inicio) return 'A data final não pode ser antes da inicial.';
  if (numeroDoDia(fim) - numeroDoDia(inicio) > 730) return 'O período é longo demais (máximo de 2 anos).';
  return { texto: `[${inicio},${dataDoNumero(numeroDoDia(fim) + 1)})` };
}

/** "[2027-02-01,2027-03-01)" → datas inclusivas. */
export function lerDaterange(p: string): { inicio: DataISO; fim: DataISO } | null {
  const m = /^[\[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})[\])]$/.exec(p);
  return m ? { inicio: m[1]!, fim: dataDoNumero(numeroDoDia(m[2]!) - 1) } : null;
}
