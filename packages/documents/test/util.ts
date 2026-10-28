import { diagnosticar, PARAMETROS_PADRAO, simular, type ContextoColaborador } from '@jc/rules-engine';
import { REGRAS_SEED } from '../../rules-engine/src/fixtures/regras';
import type { DadosRelatorio } from '../src';

export function colaboradores(n: number): ContextoColaborador[] {
  return Array.from({ length: n }, (_, i) => ({
    colaboradorId: `c${i}`, nome: `Colaborador ${String(i).padStart(3, '0')} Áçãõ`, setor: ['Loja', 'Estoque', 'Caixa'][i % 3]!, turno: i % 2 ? 'Manhã' : 'Tarde',
    empresa: { porte: 'medio', terceirizadaPublica: false }, escolaridade: i % 10 === 0 ? 'superior' : 'medio',
    salarioBaseCentavos: i % 10 === 0 ? 2_500_000 : 200_000 + (i % 5) * 10_000,
    jornadaSemanalMin: i % 4 === 0 ? 2400 : 2640, divisorContrato: i % 4 === 0 ? 200 : 220, tipoEscala: i % 4 === 0 ? '5x2' : '6x1', acordos: [],
  }));
}

export function dadosExemplo(n = 12, marca: Partial<DadosRelatorio['marca']> = {}): DadosRelatorio {
  const diagnostico = diagnosticar(colaboradores(n), '2026-10-28', REGRAS_SEED);
  const cen = (nome: string, tipo: 'contratar' | 'horas_extras', extra = {}) => ({ nome, resultado: simular(diagnostico, { ...PARAMETROS_PADRAO, tipo, encargosPct: 30, ...extra }) });
  return {
    empresa: { razaoSocial: 'Mercado Bom Preço Ltda', cnpj: '12.345.678/0001-90' }, geradoEm: '2026-10-28',
    marca: { nome: 'Contabilidade Silva & Associados', corPrimaria: '#0f766e', ...marca }, diagnostico,
    cenarios: [cen('Contratar equipe', 'contratar'), cen('Horas extras', 'horas_extras'), cen('Redução salarial', 'horas_extras', { fatorSalario: 0.9 })],
  };
}

// PNG 1x1 válido
export const PNG_1X1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
