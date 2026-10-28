import { parseDaterange } from '../datas';
import type { Regra } from '../tipos';

const base = { interjornada_min: 660, max_he_dia_min: 120, he_percentual_min: 50 };

/** Espelho das seeds de packages/db/seeds/regras.sql (um teste em @jc/db garante que não divergem). */
export const REGRAS_SEED: Regra[] = [
  { codigo: 'LEGADO_44H', vigencia: parseDaterange('[1970-01-01,2026-12-15)'), escopo: {}, prioridade: 100, ativa: true,
    parametros: { max_semanal_min: 2640, max_diaria_min: 480, folgas_semana: 1, divisor: 220, ...base } },
  { codigo: 'EC141_F1', vigencia: parseDaterange('[2026-12-15,2027-12-15)'), escopo: {}, prioridade: 100, ativa: true,
    parametros: { max_semanal_min: 2520, max_diaria_min: 480, folgas_semana: 2, divisor: 210, ...base } },
  { codigo: 'EC141_F2', vigencia: parseDaterange('[2027-12-15,)'), escopo: {}, prioridade: 100, ativa: true,
    parametros: { max_semanal_min: 2400, max_diaria_min: 480, folgas_semana: 2, divisor: 200, ...base } },
  { codigo: 'EC141_TERC_PUBLICO', vigencia: parseDaterange('[2026-12-15,2027-10-16)'), escopo: { terceirizada_publica: true }, prioridade: 200, ativa: true,
    parametros: { max_semanal_min: 2640, max_diaria_min: 480, folgas_semana: 1, divisor: 220, ...base, prazo_eliminar_6x1: '2027-10-16' } },
  { codigo: 'EC141_ALTA_RENDA', vigencia: parseDaterange('[2026-12-15,)'), escopo: { alta_renda: true }, prioridade: 300, ativa: true,
    parametros: { salario_minimo: 21188.87, exige_superior: true, jornada_diferenciada: true, folgas_semana: 2 } },
  { codigo: 'EC141_ACORDO_COMP', vigencia: parseDaterange('[1970-01-01,)'), escopo: { acordo: 'regime_compensatorio' }, prioridade: 300, ativa: true, parametros: {} },
  { codigo: 'EC141_ACORDO_DIARIA', vigencia: parseDaterange('[2026-12-15,2027-12-15)'), escopo: { acordo: 'jornada_diaria_estendida' }, prioridade: 300, ativa: true, parametros: {} },
  { codigo: 'EC141_PEQUENA_EMPRESA', vigencia: parseDaterange('[2026-12-15,)'), escopo: { porte: ['mei', 'me', 'epp'] }, prioridade: 200, ativa: false, parametros: {} },
];
