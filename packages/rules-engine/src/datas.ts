/** Datas são strings 'YYYY-MM-DD' (calendário civil de America/Sao_Paulo): sem fuso, sem surpresas de UTC. */
export type DataISO = string;

/** Intervalo [inicio, fim): inicio inclusivo e fim exclusivo (como daterange do Postgres). null = sem limite. */
export type Vigencia = { inicio: DataISO | null; fim: DataISO | null };

const RE = /^\d{4}-\d{2}-\d{2}$/;

export function validarData(d: string): DataISO {
  if (!RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new Error(`Data inválida: ${d}`);
  return d;
}

export function dataDeInstante(instante: Date, fuso = 'America/Sao_Paulo'): DataISO {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

export function somarDias(d: DataISO, dias: number): DataISO {
  const t = Date.parse(`${validarData(d)}T00:00:00Z`) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function vigenciaContem(v: Vigencia, d: DataISO): boolean {
  return (v.inicio === null || v.inicio <= d) && (v.fim === null || d < v.fim);
}

export const maxData = (a: DataISO, b: DataISO): DataISO => (a >= b ? a : b);

/** Converte o texto de um daterange do Postgres, ex.: "[2026-12-15,2027-12-15)". */
export function parseDaterange(texto: string): Vigencia {
  const m = /^([\[(])([^,]*),([^\])]*)([\])])$/.exec(texto.trim());
  if (!m) throw new Error(`daterange inválido: ${texto}`);
  const [, abre, a, b, fecha] = m as unknown as [string, string, string, string, string];
  let inicio = a === '' ? null : validarData(a);
  let fim = b === '' ? null : validarData(b);
  if (abre === '(' && inicio) inicio = somarDias(inicio, 1);
  if (fecha === ']' && fim) fim = somarDias(fim, 1);
  return { inicio, fim };
}
