import type { Pool } from 'pg';

export const FILA_ALERTAS_CONFORMIDADE = 'alertas-conformidade';
/** Todo dia às 8h10, horário de Brasília (logo depois do aviso do banco de horas). */
export const AGENDA_ALERTAS_CONFORMIDADE = { cron: '10 8 * * *', tz: 'America/Sao_Paulo' } as const;

export type ResumoAlertas = { empresas: number; avisos: number };

/**
 * Chama `avisar_conformidade`, que avisa a gestão das empresas quando uma fase da EC 141 se aproxima (ou já está em vigor) com
 * gente ainda fora da jornada e quando a escala do mês que vem ainda não foi publicada. A idempotência está no banco (chave
 * por marco/semana/mês): rodar duas vezes no mesmo dia não duplica nada.
 */
export async function processarAlertasConformidade(pool: Pool, opcoes: { hoje?: string } = {}): Promise<ResumoAlertas> {
  const hoje = opcoes.hoje ?? (await pool.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
  const r = (await pool.query<{ r: ResumoAlertas }>(`select avisar_conformidade($1::date) r`, [hoje])).rows[0]!.r;
  return { empresas: r.empresas, avisos: r.avisos };
}
