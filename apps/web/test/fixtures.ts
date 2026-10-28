import { diagnosticar, PARAMETROS_PADRAO, simular, type ContextoColaborador } from '@jc/rules-engine';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';

export function equipe(n: number): ContextoColaborador[] {
  return Array.from({ length: n }, (_, i) => ({
    colaboradorId: `c${i}`, nome: `Colaborador ${String(i).padStart(2, '0')}`, setor: ['Loja', 'Estoque', 'Caixa'][i % 3]!, turno: i % 2 ? 'Manhã' : 'Tarde',
    empresa: { porte: 'medio', terceirizadaPublica: false }, escolaridade: i % 10 === 0 ? 'superior' : 'medio',
    salarioBaseCentavos: i % 10 === 0 ? 2_500_000 : 200_000 + (i % 5) * 10_000,
    jornadaSemanalMin: i % 4 === 0 ? 2400 : 2640, divisorContrato: i % 4 === 0 ? 200 : 220, tipoEscala: i % 4 === 0 ? '5x2' : '6x1', acordos: [],
  }));
}
export const diagnostico = diagnosticar(equipe(40), '2026-10-28', REGRAS_SEED);
export const cenario = (nome: string, tipo: 'contratar' | 'horas_extras', extra = {}) => ({ nome, resultado: simular(diagnostico, { ...PARAMETROS_PADRAO, tipo, encargosPct: 30, ...extra }) });
