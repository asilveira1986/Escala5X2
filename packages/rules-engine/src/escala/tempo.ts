import { somarDias, validarData, type DataISO } from '../datas';
import type { Alocacao } from './tipos';

export const MIN_DIA = 1440;
export const NOTURNO_INICIO_MIN = 22 * 60; // 22:00
export const NOTURNO_FIM_MIN = 5 * 60; // 05:00 do dia seguinte
/** A hora noturna tem 52min30s (CLT art. 73, §1º). */
export const HORA_NOTURNA_MIN = 52.5;

export const numeroDoDia = (d: DataISO): number => Math.floor(Date.parse(`${validarData(d)}T00:00:00Z`) / 86_400_000);
export const dataDoNumero = (n: number): DataISO => new Date(n * 86_400_000).toISOString().slice(0, 10);
/** 0 = domingo ... 6 = sábado. */
export const diaDaSemana = (d: DataISO): number => new Date(`${validarData(d)}T00:00:00Z`).getUTCDay();

export function inicioDaSemana(d: DataISO, inicioSemana: 0 | 1): DataISO {
  return somarDias(d, -((diaDaSemana(d) - inicioSemana + 7) % 7));
}

export type Turno = { alocacao: Alocacao; ini: number; fim: number; brutoMin: number; liquidoMin: number; intervaloMin: number };

/** Instantes em minutos absolutos (dia × 1440 + minuto do dia), sem depender de fuso. */
export function turnoDe(a: Alocacao): Turno | null {
  if (a.tipo !== 'trabalho' || a.inicioMin === undefined || a.fimMin === undefined) return null;
  const base = numeroDoDia(a.data) * MIN_DIA;
  const intervaloMin = a.intervaloMin ?? 0;
  const brutoMin = a.fimMin - a.inicioMin;
  return { alocacao: a, ini: base + a.inicioMin, fim: base + a.fimMin, brutoMin, liquidoMin: brutoMin - intervaloMin, intervaloMin };
}

/** Turno bem formado: horários inteiros, início no dia, fim depois do início, no máximo 24h, intervalo menor que o turno. */
export function turnoValido(a: Alocacao): boolean {
  if (a.tipo !== 'trabalho') return true;
  const { inicioMin: i, fimMin: f, intervaloMin: v = 0 } = a;
  if (i === undefined || f === undefined) return false;
  if (![i, f, v].every(Number.isInteger)) return false;
  return i >= 0 && i < MIN_DIA && f > i && f - i <= MIN_DIA && v >= 0 && v < f - i;
}

/** Minutos de [ini, fim) dentro do período noturno (22:00 às 05:00), para qualquer quantidade de dias. */
export function minutosNoturnos(ini: number, fim: number): number {
  let total = 0;
  for (let dia = Math.floor(ini / MIN_DIA); dia <= Math.floor(fim / MIN_DIA) + 1; dia++) {
    const a = dia * MIN_DIA - (MIN_DIA - NOTURNO_INICIO_MIN); // 22:00 do dia anterior
    const b = dia * MIN_DIA + NOTURNO_FIM_MIN; // 05:00 do dia
    total += Math.max(0, Math.min(fim, b) - Math.max(ini, a));
  }
  return total;
}

/** 9h30 → "9h30"; 600 → "10h". */
export function duracao(min: number): string {
  const sinal = min < 0 ? '-' : '';
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sinal}${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

export const dataBr = (d: DataISO): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
export const hhmm = (min: number): string => `${String(Math.floor((min % MIN_DIA) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
