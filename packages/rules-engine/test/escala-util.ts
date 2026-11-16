import type { Alocacao, ContextoColaborador } from '../src';
import { somarDias } from '../src';
import { colab } from './util';

export const hm = (s: string): number => { const [h, m] = s.split(':').map(Number); return h! * 60 + m!; };

export const turno = (colaboradorId: string, data: string, ini = '08:00', fim = '17:00', intervaloMin = 60): Alocacao =>
  ({ colaboradorId, data, tipo: 'trabalho', inicioMin: hm(ini), fimMin: ini <= fim ? hm(fim) : hm(fim) + 1440, intervaloMin });

export const folga = (colaboradorId: string, data: string): Alocacao => ({ colaboradorId, data, tipo: 'folga' });

/** Colaborador em 5x2, 40h semanais. */
export const c5x2 = (id: string, extra: Partial<ContextoColaborador> = {}): ContextoColaborador =>
  colab({ colaboradorId: id, nome: `Pessoa ${id}`, tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, ...extra });

/** Semana de 5 dias de trabalho a partir de `inicio` (segunda), sem alterar o dia da semana de quem passa. */
export function diasDeTrabalho(id: string, inicio: string, quantos: number, ini = '08:00', fim = '17:00', intervalo = 60): Alocacao[] {
  return Array.from({ length: quantos }, (_, i) => turno(id, somarDias(inicio, i), ini, fim, intervalo));
}
