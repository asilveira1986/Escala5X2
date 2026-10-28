/** Formatação pt-BR: dd/mm/aaaa, BRL, horas. Funções puras, seguras para cliente e servidor. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (casas: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const moeda = (centavos: number): string => brl.format(centavos / 100).replace(/ /g, ' ');

/** Valor da hora: arredonda para centavos (a precisão total fica no cálculo, não na exibição). */
export const moedaHora = (centavos: number): string => moeda(Math.round(centavos));

export function data(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** 2640 → "44h", 2670 → "44h30". */
export function horasMin(min: number): string {
  const sinal = min < 0 ? '-' : '';
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sinal}${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

export const decimal = (n: number, casas = 2): string => num(casas).format(n);
export const inteiro = (n: number): string => num(0).format(n);

export const ROTULO_CLASSIFICACAO = {
  adequado: 'Adequado',
  adequacao_f1: 'Adequar na fase 1',
  adequacao_f2: 'Adequar na fase 2',
  excecao: 'Exceção',
} as const;

export const ROTULO_EXCECAO = { alta_renda: 'Alta renda', acordo: 'Acordo coletivo' } as const;
export const ROTULO_CENARIO = {
  contratar: 'Contratar', horas_extras: 'Pagar horas extras', reorganizar_turnos: 'Reorganizar turnos', acordo_compensatorio: 'Acordo compensatório',
} as const;
