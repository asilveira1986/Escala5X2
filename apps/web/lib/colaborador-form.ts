import { validarColaboradores, type CampoColaborador, type ColaboradorImportado } from '@jc/connectors';

/** 2640 → "44:00" (formato aceito pelos campos de horas). */
export const minutosParaHoras = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
/** 2500.5 → "2.500,50". */
export const reaisParaTexto = (v: number | string) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CAMPOS_CONTRATO = ['salario', 'jornada_semanal', 'tipo_escala', 'divisor', 'folgas_semana', 'horas_extras_mensais', 'turno'] as const;
const FICTICIO = { nome: 'Fulano de Tal', cpf: '52998224725', admissao: '01/01/2000' };

export type ResultadoContrato =
  | { ok: true; contrato: Pick<ColaboradorImportado, 'salarioCentavos' | 'jornadaSemanalMin' | 'divisor' | 'tipoEscala' | 'folgasSemana' | 'horasExtrasMensaisMin' | 'turno'> }
  | { ok: false; erros: Partial<Record<CampoColaborador, string>> };

/** Valida só os campos do contrato com as mesmas regras da importação (completando os da pessoa com valores fictícios). */
export function validarContrato(valores: Record<string, string>): ResultadoContrato {
  const linha: Record<string, string> = { ...FICTICIO };
  for (const c of CAMPOS_CONTRATO) linha[c] = (valores[c] ?? '').trim();
  const { validas, erros } = validarColaboradores([linha], Object.fromEntries(Object.keys(linha).map((c) => [c, c])));
  if (erros.length > 0 || !validas[0]) return { ok: false, erros: Object.fromEntries(erros.map((e) => [e.campo === 'geral' ? 'salario' : e.campo, e.mensagem])) };
  const c = validas[0];
  return { ok: true, contrato: { salarioCentavos: c.salarioCentavos, jornadaSemanalMin: c.jornadaSemanalMin, divisor: c.divisor, tipoEscala: c.tipoEscala, folgasSemana: c.folgasSemana, horasExtrasMensaisMin: c.horasExtrasMensaisMin, turno: c.turno } };
}
