import { parseDaterange, type Alocacao, type Ausencia, type ContextoColaborador, type DemandaCobertura, type EscalaInput, type Feriado, type Regra } from '@jc/rules-engine';
import { z } from 'zod';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const vig = z.string().transform((t) => parseDaterange(t));
const aloc = z.object({
  id: z.string().optional(), colaboradorId: z.string(), data,
  tipo: z.enum(['trabalho', 'folga', 'dsr', 'ferias', 'afastamento', 'feriado']),
  inicioMin: z.number().nullable().optional(), fimMin: z.number().nullable().optional(), intervaloMin: z.number().nullable().optional(),
});
const entradaZ = z.object({
  escala: z.object({
    id: z.string(), empresa_id: z.string(), setor_id: z.string().nullable(), nome: z.string(),
    status: z.enum(['rascunho', 'publicada', 'substituida']), revisao: z.number().int(), versao: z.number().int(), inicio: data, fim: data,
  }),
  empresa: z.object({ id: z.string(), porte: z.enum(['mei', 'me', 'epp', 'medio', 'grande']), terceirizada_publica: z.boolean(), uf: z.string(), municipio_ibge: z.string() }),
  regras: z.array(z.object({
    codigo: z.string(), vigencia: vig, escopo: z.record(z.unknown()), parametros: z.record(z.unknown()), prioridade: z.number().int(), ativa: z.boolean(),
  })),
  colaboradores: z.array(z.object({
    id: z.string(), nome: z.string(), setor: z.string().nullable(), turno: z.string().nullable(),
    escolaridade: z.enum(['fundamental', 'medio', 'superior', 'pos']).nullable(),
    admissao: data, desligamento: data.nullable(),
    salario_centavos: z.number().int(), jornada_semanal_min: z.number().int(), divisor: z.number().int(),
    tipo_escala: z.enum(['6x1', '5x2', '12x36', 'personalizada']), folgas_semana: z.number().int().nullable(),
    horas_extras_mensais_min: z.number().int(),
    acordos: z.array(z.object({
      id: z.string(), vigencia: vig, status: z.enum(['rascunho', 'revisado', 'vigente', 'expirado']),
      clausulas: z.array(z.object({ tipo: z.enum(['regime_compensatorio', 'jornada_diaria_estendida', 'banco_horas', 'adicional_he', 'rodizio_domingo']), parametros: z.record(z.unknown()) })),
    })),
  })),
  sem_contrato: z.array(z.object({ id: z.string(), nome: z.string() })),
  alocacoes: z.array(aloc), anteriores: z.array(aloc),
  ausencias: z.array(z.object({ colaboradorId: z.string(), inicio: data, fim: data, tipo: z.enum(['ferias', 'afastamento']) })),
  feriados: z.array(z.object({ data, nome: z.string(), abrangencia: z.enum(['nacional', 'estadual', 'municipal']) })),
  cobertura: z.array(z.object({ diaSemana: z.number().int(), faixaInicioMin: z.number().int(), faixaFimMin: z.number().int(), minimo: z.number().int(), ideal: z.number().int().nullable() })),
});

export type EntradaEscala = {
  escala: { id: string; empresaId: string; setorId: string | null; nome: string; status: 'rascunho' | 'publicada' | 'substituida'; revisao: number; versao: number; inicio: string; fim: string };
  regras: Regra[];
  colaboradores: ContextoColaborador[];
  semContrato: Array<{ id: string; nome: string }>;
  alocacoes: Alocacao[];
  anteriores: Alocacao[];
  ausencias: Ausencia[];
  feriados: Feriado[];
  cobertura: DemandaCobertura[];
};

const limpar = (a: z.infer<typeof aloc>): Alocacao => ({
  colaboradorId: a.colaboradorId, data: a.data, tipo: a.tipo,
  ...(a.inicioMin != null ? { inicioMin: a.inicioMin } : {}), ...(a.fimMin != null ? { fimMin: a.fimMin } : {}),
  ...(a.intervaloMin != null ? { intervaloMin: a.intervaloMin } : {}),
});

/** Valida o JSON de `escala_entrada` e converte para os tipos do motor. */
export function lerEntradaEscala(json: unknown): EntradaEscala {
  const e = entradaZ.parse(json);
  return {
    escala: { id: e.escala.id, empresaId: e.escala.empresa_id, setorId: e.escala.setor_id, nome: e.escala.nome, status: e.escala.status, revisao: e.escala.revisao, versao: e.escala.versao, inicio: e.escala.inicio, fim: e.escala.fim },
    regras: e.regras,
    semContrato: e.sem_contrato,
    colaboradores: e.colaboradores.map((c): ContextoColaborador => ({
      colaboradorId: c.id, nome: c.nome, setor: c.setor, turno: c.turno,
      empresa: { porte: e.empresa.porte, terceirizadaPublica: e.empresa.terceirizada_publica, uf: e.empresa.uf, municipioIbge: e.empresa.municipio_ibge },
      escolaridade: c.escolaridade, salarioBaseCentavos: c.salario_centavos, jornadaSemanalMin: c.jornada_semanal_min,
      divisorContrato: c.divisor, tipoEscala: c.tipo_escala, folgasSemana: c.folgas_semana,
      horasExtrasMensaisMin: c.horas_extras_mensais_min, acordos: c.acordos, admissao: c.admissao, desligamento: c.desligamento,
    })),
    alocacoes: e.alocacoes.map(limpar),
    anteriores: e.anteriores.map(limpar),
    ausencias: e.ausencias,
    feriados: e.feriados,
    cobertura: e.cobertura.map((d) => ({ diaSemana: d.diaSemana, faixaInicioMin: d.faixaInicioMin, faixaFimMin: d.faixaFimMin, minimo: d.minimo, ...(d.ideal != null ? { ideal: d.ideal } : {}) })),
  };
}

export function paraEscalaInput(e: EntradaEscala, alocacoes: Alocacao[] = e.alocacoes): EscalaInput {
  return { periodo: { inicio: e.escala.inicio, fim: e.escala.fim }, alocacoes, anteriores: e.anteriores, ausencias: e.ausencias, feriados: e.feriados, cobertura: e.cobertura };
}

