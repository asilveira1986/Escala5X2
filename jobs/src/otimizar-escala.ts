import { ErroServico, gerarPropostas, lerEntradaEscala, type ConfigOtimizador, type OpcoesOtimizacao } from '@jc/servicos';
import { VERSAO_MOTOR } from '@jc/rules-engine';
import type { Pool } from 'pg';

export const FILA_OTIMIZAR_ESCALA = 'otimizar-escala';

export type ConfigOtimizadorJob = ConfigOtimizador & { esperaMs?: number; tentativasOcupado?: number };

type Linha = { id: string; status: string; entrada: unknown; opcoes: { turnos: OpcoesOtimizacao['turnos']; tempoLimiteS: number; numSolucoes: 1 | 2 | 3; usarRascunhoComoReferencia?: boolean }; criado_por: string | null };

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Processa um pedido de otimização. O job só carrega o id; entrada e opções vêm da linha `otimizacao`, criada pelo
 * usuário por `solicitar_otimizacao` (que confere permissão), então um job forjado não ganha poder nenhum.
 * A chamada ao otimizador acontece FORA de transação (pode levar até um minuto). Idempotente: só processa 'pendente'.
 * Devolve o estado final, ou null se o pedido não estava pendente.
 */
export async function processarOtimizacao(pool: Pool, id: string, cfg: ConfigOtimizadorJob | null): Promise<'concluida' | 'erro' | null> {
  let linha: Linha | undefined;
  {
    const cx = await pool.connect();
    try {
      await cx.query('begin');
      linha = (await cx.query<Linha>(`select id, status, entrada, opcoes, criado_por from otimizacao where id = $1 for update`, [id])).rows[0];
      if (!linha) throw new Error(`Otimização ${id} não encontrada`);
      if (linha.status !== 'pendente') { await cx.query('rollback'); return null; }
      await cx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: linha.criado_por })]);   // auditoria atribuída a quem pediu
      await cx.query(`update otimizacao set status = 'processando', iniciado_em = now() where id = $1`, [id]);
      await cx.query('commit');
    } catch (e) {
      await cx.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      cx.release();
    }
  }

  const finalizar = async (campos: { status: 'concluida' | 'erro'; resumo?: unknown; resultado?: unknown; erro?: string }) => {
    const cx = await pool.connect();
    try {
      await cx.query('begin');
      // as escritas ficam atribuídas a quem pediu (auditoria)
      await cx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: linha!.criado_por })]);
      await cx.query(`update otimizacao set status = $2, resumo = $3, resultado = $4, erro = $5, concluido_em = now() where id = $1`,
        [id, campos.status, campos.resumo == null ? null : JSON.stringify(campos.resumo), campos.resultado == null ? null : JSON.stringify(campos.resultado), campos.erro ?? null]);
      await cx.query('commit');
    } catch (e) {
      await cx.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      cx.release();
    }
  };

  try {
    if (!cfg) throw new ErroServico('O otimizador não está configurado neste ambiente (OPTIMIZER_URL e OPTIMIZER_TOKEN).');
    const entrada = lerEntradaEscala(linha.entrada);
    const o = linha.opcoes;
    const opcoes: OpcoesOtimizacao = { turnos: o.turnos, tempoLimiteS: o.tempoLimiteS, numSolucoes: o.numSolucoes, ...(o.usarRascunhoComoReferencia ? { referencia: entrada.alocacoes } : {}) };
    let r: Awaited<ReturnType<typeof gerarPropostas>> | undefined;
    const tentativas = cfg.tentativasOcupado ?? 4;
    for (let t = 1; t <= tentativas; t++) {
      try { r = await gerarPropostas(entrada, opcoes, cfg); break; } catch (e) {
        if (e instanceof ErroServico && /ocupado/.test(e.message) && t < tentativas) { await dormir(cfg.esperaMs ?? 5000); continue; }
        throw e;
      }
    }
    if (!r) throw new ErroServico('Não foi possível gerar as propostas.');
    for (const d of r.divergencias) {
      // O modelo e o motor discordaram: a proposta foi descartada. Vai para o log do servidor (o Sentry entra na Fase 4).
      console.error('[otimizador] divergência: proposta descartada pelo motor TypeScript', { otimizacao: id, indice: d.indice, bloqueios: d.resultado.violacoes.filter((v) => v.severidade === 'bloqueio').slice(0, 5).map((v) => v.codigo) });
    }
    const resumo = {
      status: r.status, mensagem: r.mensagem ?? null, tempoMs: r.tempoMs, descartadas: r.descartadas, versaoMotor: VERSAO_MOTOR,
      propostas: r.propostas.map((p) => ({ indice: p.indice, status: p.status, metricas: p.metricas, alertas: p.alertas, infos: p.infos })),
    };
    await finalizar({ status: 'concluida', resumo, resultado: { ...resumo, propostas: r.propostas } });
    return 'concluida';
  } catch (e) {
    const msg = e instanceof ErroServico ? e.message : 'Falha inesperada ao gerar as propostas. Tente novamente.';
    if (!(e instanceof ErroServico)) console.error('[otimizador] falha', { otimizacao: id, erro: e });
    await finalizar({ status: 'erro', erro: msg });
    return 'erro';
  }
}
