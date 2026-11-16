import type { DataISO } from '../datas';

export type TipoAlocacao = 'trabalho' | 'folga' | 'dsr' | 'ferias' | 'afastamento' | 'feriado';

/**
 * Uma linha da escala. `data` é o dia civil (fuso de São Paulo) em que o turno COMEÇA; os horários são minutos
 * desde 00:00 desse dia. Um turno que cruza a meia-noite tem `fimMin` acima de 1440 (ex.: 22:00 às 06:00 =
 * inicioMin 1320, fimMin 1800). Turno partido: modele como um turno com intervalo.
 */
export type Alocacao = {
  colaboradorId: string;
  data: DataISO;
  tipo: TipoAlocacao;
  inicioMin?: number;
  fimMin?: number;
  /** Intervalo intrajornada, não remunerado, dentro do turno. */
  intervaloMin?: number;
};

export type Feriado = { data: DataISO; nome: string; abrangencia: 'nacional' | 'estadual' | 'municipal' };

/** Férias, atestado, licença: períodos inclusivos nas duas pontas. */
export type Ausencia = { colaboradorId: string; inicio: DataISO; fim: DataISO; tipo: 'ferias' | 'afastamento' };

/** Cobertura mínima de um setor numa faixa horária. `faixaFimMin` menor ou igual ao início indica que cruza a meia-noite. */
export type DemandaCobertura = { diaSemana: number; faixaInicioMin: number; faixaFimMin: number; minimo: number; ideal?: number };

export type EscalaInput = {
  /** Período a validar; `fim` inclusivo. */
  periodo: { inicio: DataISO; fim: DataISO };
  alocacoes: Alocacao[];
  /** Dias anteriores ao período (para interjornada e semanas que atravessam a virada do mês). */
  anteriores?: Alocacao[];
  ausencias?: Ausencia[];
  feriados?: Feriado[];
  cobertura?: DemandaCobertura[];
  /** 0 = domingo, 1 = segunda (padrão). */
  inicioSemana?: 0 | 1;
};

export type Severidade = 'bloqueio' | 'alerta' | 'info';

export type CodigoViolacao =
  | 'TURNO_INCOMPLETO' | 'SOBREPOSICAO_TURNOS' | 'INTERJORNADA' | 'INTERVALO_INTRAJORNADA' | 'INTERVALO_ACIMA_DO_MAXIMO'
  | 'JORNADA_DIARIA_EXCEDIDA' | 'HORA_EXTRA_PROGRAMADA' | 'LIMITE_SEMANAL' | 'FOLGAS_SEMANA' | 'RODIZIO_DOMINGO'
  | 'TRABALHO_EM_FERIADO' | 'TRABALHO_EM_AUSENCIA' | 'FORA_DO_VINCULO' | 'COLABORADOR_DESCONHECIDO'
  | 'COBERTURA_MINIMA' | 'COBERTURA_IDEAL';

export type Violacao = {
  codigo: CodigoViolacao;
  severidade: Severidade;
  colaboradorId?: string;
  data?: DataISO;
  mensagem: string;
  sugestao?: string;
  /** Regras vigentes que embasam a validação (rastreabilidade jurídica). */
  regrasAplicadas?: string[];
  detalhe: Record<string, unknown>;
};

export type OpcoesValidacao = {
  /** Sobrescreve EscalaInput.inicioSemana. */
  inicioSemana?: 0 | 1;
};
