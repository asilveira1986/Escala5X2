import type { DataISO, Vigencia } from './datas';

export type Porte = 'mei' | 'me' | 'epp' | 'medio' | 'grande';
export type Escolaridade = 'fundamental' | 'medio' | 'superior' | 'pos';
export type TipoEscala = '6x1' | '5x2' | '12x36' | 'personalizada';

/** Regra legal como dado (linha de regra_jornada). */
export type Regra = {
  codigo: string;
  vigencia: Vigencia;
  escopo: Record<string, unknown>;
  parametros: Record<string, unknown>;
  prioridade: number;
  ativa: boolean;
};

export type TipoClausula = 'regime_compensatorio' | 'jornada_diaria_estendida' | 'banco_horas' | 'adicional_he' | 'rodizio_domingo';
export type Clausula = { tipo: TipoClausula; parametros: Record<string, unknown> };
export type AcordoDoColaborador = {
  id: string;
  vigencia: Vigencia;
  status: 'rascunho' | 'revisado' | 'vigente' | 'expirado';
  clausulas: Clausula[];
};

export type ContextoColaborador = {
  colaboradorId: string;
  nome: string;
  setor?: string | null;
  turno?: string | null;
  empresa: { porte: Porte; terceirizadaPublica: boolean; uf?: string; municipioIbge?: string };
  escolaridade: Escolaridade | null;
  /** Dinheiro sempre em centavos inteiros. */
  salarioBaseCentavos: number;
  jornadaSemanalMin: number;
  divisorContrato: number;
  tipoEscala: TipoEscala;
  /** Se ausente, deduz-se do tipo de escala. */
  folgasSemana?: number | null;
  horasExtrasMensaisMin?: number;
  acordos: AcordoDoColaborador[];
};

export type RegrasEfetivas = {
  maxSemanalMin: number;
  maxDiariaMin: number;
  folgasPorSemana: number;
  divisor: number;
  interjornadaMin: number;
  maxHoraExtraDiaMin: number;
  /** Adicional mínimo de hora extra (%): o maior entre a regra legal e o acordo. */
  adicionalHePercentual: number;
  domingoRodizio?: { aCadaNSemanas: number };
  regimeCompensatorio?: { escala: string; maxDiariaMin: number };
  bancoHoras?: Record<string, unknown>;
  /** Teto semanal geral, antes das exceções (alta renda e acordos). */
  tetoGeralSemanalMin: number;
  /** Códigos das regras aplicadas, na ordem de mescla (rastreabilidade jurídica). */
  regrasAplicadas: string[];
};

export class ErroRegras extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroRegras';
  }
}

export type { DataISO, Vigencia };
