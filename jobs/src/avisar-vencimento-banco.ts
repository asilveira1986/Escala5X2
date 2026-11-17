import { calcularSaldo, type Lancamento } from '@jc/servicos';
import type { Pool } from 'pg';

export const FILA_AVISO_BANCO = 'avisar-vencimento-banco';
/** Todo dia às 8h, horário de Brasília. */
export const AGENDA_AVISO_BANCO = { cron: '0 8 * * *', tz: 'America/Sao_Paulo' } as const;

export type ResumoAviso = { empresas: number; colaboradores: number; avisos: number };

/**
 * Para cada empresa com banco de horas, calcula o saldo (mesma conta da tela: FIFO por vencimento) e manda para o banco
 * de dados criar os avisos. A idempotência está lá (chave por semana/mês): rodar duas vezes no mesmo dia não duplica nada.
 * Uma empresa com erro não impede as outras; os erros sobem juntos no fim para o job constar como falho.
 */
export async function processarAvisoVencimento(pool: Pool, opcoes: { hoje?: string } = {}): Promise<ResumoAviso> {
  const hoje = opcoes.hoje ?? (await pool.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
  const empresas = (await pool.query<{ empresa_id: string }>(`select distinct empresa_id from banco_horas_lancamento`)).rows.map((r) => r.empresa_id);
  const resumo: ResumoAviso = { empresas: 0, colaboradores: 0, avisos: 0 };
  const erros: string[] = [];
  for (const emp of empresas) {
    try {
      const lan = (await pool.query<Lancamento>(
        `select id, colaborador_id, data::text, minutos, origem, descricao, vence_em::text, estorna_id, criado_em::text from banco_horas_lancamento where empresa_id = $1 order by id`, [emp])).rows;
      const desligados = new Set((await pool.query<{ id: string }>(`select id from colaborador where empresa_id = $1 and desligamento is not null and desligamento < $2::date`, [emp, hoje])).rows.map((r) => r.id));
      const porPessoa = new Map<string, Lancamento[]>();
      for (const l of lan) porPessoa.set(l.colaborador_id, [...(porPessoa.get(l.colaborador_id) ?? []), { ...l, id: Number(l.id) }]);
      const itens: { colaboradorId: string; aVencerMin: number; venceEm: string | null; vencidoMin: number }[] = [];
      for (const [colaboradorId, ls] of porPessoa) {
        const s = calcularSaldo(ls, hoje);
        // quem já saiu da empresa não tem o que compensar: só interessa o vencido (a pagar na rescisão)
        const aVencerMin = desligados.has(colaboradorId) ? 0 : s.aVencerMin;
        if (aVencerMin > 0 || s.vencidoMin > 0) itens.push({ colaboradorId, aVencerMin, venceEm: s.proximoVencimento?.venceEm ?? null, vencidoMin: s.vencidoMin });
      }
      if (itens.length === 0) continue;
      const r = (await pool.query<{ r: { colaboradores: number; avisosColaborador: number } }>(`select avisar_vencimento_banco($1, $2::date, $3::jsonb) r`, [emp, hoje, JSON.stringify(itens)])).rows[0]!.r;
      resumo.empresas++; resumo.colaboradores += r.colaboradores; resumo.avisos += r.avisosColaborador;
    } catch (e) {
      erros.push(`${emp}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (erros.length > 0) throw new Error(`Aviso de vencimento falhou em ${erros.length} empresa(s): ${erros.join(' | ').slice(0, 500)}`);
  return resumo;
}
