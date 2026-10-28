import { parseDaterange, type ContextoColaborador, type Regra } from '@jc/rules-engine';
import { z } from 'zod';

const vig = z.string().transform((t) => parseDaterange(t));
const regraZ = z.object({
  codigo: z.string(), vigencia: vig, escopo: z.record(z.unknown()), parametros: z.record(z.unknown()),
  prioridade: z.number().int(), ativa: z.boolean(),
});
const colabZ = z.object({
  id: z.string(), nome: z.string(), setor: z.string().nullable(), turno: z.string().nullable(),
  escolaridade: z.enum(['fundamental', 'medio', 'superior', 'pos']).nullable(),
  salario_centavos: z.number().int(), jornada_semanal_min: z.number().int(), divisor: z.number().int(),
  tipo_escala: z.enum(['6x1', '5x2', '12x36', 'personalizada']), folgas_semana: z.number().int().nullable(),
  horas_extras_mensais_min: z.number().int(),
  acordos: z.array(z.object({
    id: z.string(), vigencia: vig, status: z.enum(['rascunho', 'revisado', 'vigente', 'expirado']),
    clausulas: z.array(z.object({
      tipo: z.enum(['regime_compensatorio', 'jornada_diaria_estendida', 'banco_horas', 'adicional_he', 'rodizio_domingo']),
      parametros: z.record(z.unknown()),
    })),
  })),
});
const entradaZ = z.object({
  empresa: z.object({ id: z.string(), porte: z.enum(['mei', 'me', 'epp', 'medio', 'grande']), terceirizada_publica: z.boolean(), uf: z.string(), municipio_ibge: z.string() }).nullable(),
  regras: z.array(regraZ),
  sem_contrato: z.number().int(),
  colaboradores: z.array(colabZ),
});

export type EntradaDiagnostico = { regras: Regra[]; colaboradores: ContextoColaborador[]; semContrato: number };

/** Valida o JSON devolvido por `diagnostico_entrada` e o converte para os tipos do motor. */
export function lerEntradaDiagnostico(json: unknown): EntradaDiagnostico {
  const e = entradaZ.parse(json);
  if (!e.empresa) throw new Error('Empresa não encontrada ou sem acesso');
  const empresa = e.empresa;
  return {
    regras: e.regras,
    semContrato: e.sem_contrato,
    colaboradores: e.colaboradores.map((c) => ({
      colaboradorId: c.id, nome: c.nome, setor: c.setor, turno: c.turno,
      empresa: { porte: empresa.porte, terceirizadaPublica: empresa.terceirizada_publica, uf: empresa.uf, municipioIbge: empresa.municipio_ibge },
      escolaridade: c.escolaridade, salarioBaseCentavos: c.salario_centavos, jornadaSemanalMin: c.jornada_semanal_min,
      divisorContrato: c.divisor, tipoEscala: c.tipo_escala, folgasSemana: c.folgas_semana,
      horasExtrasMensaisMin: c.horas_extras_mensais_min, acordos: c.acordos,
    })),
  };
}
