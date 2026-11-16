import type { EntradaEscala, TurnoOtimizacao } from '../src';
import { REGRAS_SEED } from '../../rules-engine/src/fixtures/regras';
import { colab } from '../../rules-engine/test/util';

export const TURNOS: TurnoOtimizacao[] = [
  { id: 'manha', inicioMin: 480, fimMin: 1020, intervaloMin: 60 },   // 8h líquidas
  { id: 'longo', inicioMin: 480, fimMin: 1140, intervaloMin: 60 },   // 10h líquidas: passa do limite diário
  { id: 'sem-intervalo', inicioMin: 480, fimMin: 960, intervaloMin: 0 }, // 8h sem intervalo: viola a intrajornada
  { id: 'noite', inicioMin: 1320, fimMin: 1800, intervaloMin: 60 },  // 22h–06h
];

export function entrada(extra: Partial<EntradaEscala> = {}, inicio = '2027-02-01', fim = '2027-02-14'): EntradaEscala {
  return {
    escala: { id: 'e1', empresaId: 'emp', setorId: null, nome: 'Fev', status: 'rascunho', revisao: 1, versao: 1, inicio, fim },
    regras: REGRAS_SEED,
    colaboradores: [colab({ colaboradorId: 'a', nome: 'Ana', tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, salarioBaseCentavos: 300_000, admissao: '2020-01-01', desligamento: null })],
    semContrato: [], alocacoes: [], anteriores: [], ausencias: [], feriados: [], cobertura: [],
    ...extra,
  };
}

