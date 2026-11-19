import type { DataISO } from '@jc/rules-engine';

export type SituacaoAusencia = 'andamento' | 'agendada' | 'encerrada';
export const ROTULO_SITUACAO: Record<SituacaoAusencia, string> = { andamento: 'Em andamento', agendada: 'Agendada', encerrada: 'Encerrada' };
export const TOM_SITUACAO: Record<SituacaoAusencia, 'verde' | 'azul' | 'cinza'> = { andamento: 'verde', agendada: 'azul', encerrada: 'cinza' };

/** Situação da ausência em relação a hoje (o último dia conta, é inclusivo). */
export function situacaoAusencia(inicio: DataISO, fim: DataISO, hoje: DataISO): SituacaoAusencia {
  if (hoje < inicio) return 'agendada';
  return hoje > fim ? 'encerrada' : 'andamento';
}

/** Quantidade de dias corridos, contando o primeiro e o último. */
export function diasDaAusencia(inicio: DataISO, fim: DataISO): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) + 1;
}
