'use server';

import { adequarEscala, carregarEntradaEscala, ErroAdequacao, ErroServico, type CoberturaDia, type ResumoPessoa, type TurnoAdequacao } from '@jc/servicos';
import type { Violacao } from '@jc/rules-engine';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { paraGravacao } from '@/lib/escala-editor';
import { minutosDeHora } from '@/lib/adequador-ui';

const turnoZ = z.object({
  nome: z.string().trim().min(1, 'Dê um nome a cada turno.').max(40),
  inicio: z.string(), fim: z.string(), intervalo: z.coerce.number().int().min(0).max(240),
  modeloId: z.string().uuid().nullable(), minimo: z.array(z.coerce.number().int().min(0).max(500)).length(7),
});
const pedidoZ = z.object({
  empresaId: z.string().uuid(), mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), setorId: z.string().uuid().nullable(),
  diasPorSemana: z.number().int().min(1).max(6).nullable(), turnos: z.array(turnoZ).min(1, 'Informe pelo menos um turno.').max(6, 'No máximo 6 turnos.'),
});
export type PedidoAdequacao = z.input<typeof pedidoZ>;

export type ResultadoAdequacaoWeb =
  | {
    ok: true; escalaId: string; revisao: number; criada: boolean;
    resumo: { necessarioTotal: number; alocadoTotal: number; faltaTotal: number; percentualAtendido: number; diasComFalta: number; pessoasAlocadas: number };
    avisos: string[]; bloqueios: number; alertas: number; violacoes: { codigo: string; severidade: string; quantidade: number; exemplo: string }[];
    faltas: CoberturaDia[]; pessoas: ResumoPessoa[];
    turnos: { id: string; nome: string }[];
    grade: { dias: string[]; linhas: { colaboradorId: string; nome: string; celulas: string[] }[] };
  }
  | { ok: false; erro: string };

const MAX_FALTAS = 80;

/**
 * Gera a alocação da equipe para o mês a partir das horas e da cobertura informadas e a GRAVA num rascunho
 * ("Adequação AAAA-MM"), que pode ser aberto no editor, ajustado e publicado como qualquer escala.
 * Gerar de novo troca a alocação desse rascunho (nunca mexe em escala publicada).
 */
export async function adequar(pedido: PedidoAdequacao): Promise<ResultadoAdequacaoWeb> {
  const p = pedidoZ.safeParse(pedido);
  if (!p.success) return { ok: false, erro: p.error.issues[0]?.message ?? 'Pedido inválido.' };
  const d = p.data;
  const turnos: TurnoAdequacao[] = [];
  for (const [i, t] of d.turnos.entries()) {
    const ini = minutosDeHora(t.inicio), f = minutosDeHora(t.fim);
    if (ini === null || f === null) return { ok: false, erro: `Horário inválido no turno ${t.nome}.` };
    const fim = f <= ini ? f + 1440 : f;                                 // termina no dia seguinte
    turnos.push({ id: t.modeloId ?? `t${i + 1}`, nome: t.nome, inicioMin: ini, fimMin: fim, intervaloMin: t.intervalo, minimo: t.minimo, modeloId: t.modeloId });
  }
  const { supabase, user } = await exigirUsuario();
  try {
    // rascunho "Adequação": reaproveita o do mês (e setor) se já existir
    const nome = `Adequação ${d.mes}`;
    let q = supabase.from('escala').select('id').eq('empresa_id', d.empresaId).eq('status', 'rascunho').eq('nome', nome);
    q = d.setorId ? q.eq('setor_id', d.setorId) : q.is('setor_id', null);
    const { data: ex } = await q.limit(1);
    let escalaId = (Array.isArray(ex) ? (ex[0] as { id: string } | undefined)?.id : undefined) ?? null;
    let criada = false;
    if (!escalaId) {
      const [ano, m] = d.mes.split('-').map(Number) as [number, number];
      const proximo = m === 12 ? `${ano + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, '0')}-01`;
      const { data: nova, error } = await supabase.from('escala').insert({ empresa_id: d.empresaId, setor_id: d.setorId, nome, periodo: `[${d.mes}-01,${proximo})`, criado_por: user.id }).select('id').single();
      if (error || !nova) return { ok: false, erro: /row-level|permission/i.test(error?.message ?? '') ? 'Você não tem permissão para criar escalas nesta empresa.' : 'Não foi possível criar o rascunho da escala.' };
      escalaId = (nova as { id: string }).id; criada = true;
    }
    const entrada = await carregarEntradaEscala(supabase, escalaId);
    if (entrada.escala.empresaId !== d.empresaId) return { ok: false, erro: 'Escala não encontrada.' };
    const r = adequarEscala(entrada, { turnos, ...(d.diasPorSemana ? { diasPorSemana: d.diasPorSemana } : {}) });
    const { data: rev, error: e2 } = await supabase.rpc('salvar_alocacoes', { p_escala: escalaId, p_revisao: entrada.escala.revisao, p_alocacoes: paraGravacao(r.alocacoes) });
    if (e2) return { ok: false, erro: /permission|row-level/i.test(e2.message) ? 'Você não tem permissão para alterar esta escala.' : 'A alocação foi calculada, mas não foi possível gravá-la no rascunho. Tente de novo.' };

    const porCodigo = new Map<string, { v: Violacao; n: number }>();
    for (const v of r.violacoes) { const k = `${v.codigo}|${v.severidade}`; const x = porCodigo.get(k); if (x) x.n++; else porCodigo.set(k, { v, n: 1 }); }
    const indiceTurno = new Map(turnos.map((t, i) => [t.id, i]));
    const dias = [...new Set(r.alocacoes.map((a) => a.data))].sort();
    const celula = new Map(r.alocacoes.map((a) => [`${a.colaboradorId}|${a.data}`, a]));
    const linhasGrade = r.pessoas.map((pes) => ({
      colaboradorId: pes.colaboradorId, nome: pes.nome,
      celulas: dias.map((dia) => { const a = celula.get(`${pes.colaboradorId}|${dia}`); return !a ? '' : a.tipo === 'trabalho' ? String(indiceTurno.get(r.turnoDe[pes.colaboradorId]!) ?? 0) : 'F'; }),
    }));
    return {
      ok: true, escalaId, revisao: Number(rev), criada, resumo: r.resumo, avisos: r.avisos,
      bloqueios: r.violacoes.filter((v) => v.severidade === 'bloqueio').length, alertas: r.violacoes.filter((v) => v.severidade === 'alerta').length,
      violacoes: [...porCodigo.values()].sort((a, b) => (a.v.severidade === 'bloqueio' ? 0 : 1) - (b.v.severidade === 'bloqueio' ? 0 : 1) || b.n - a.n).slice(0, 12).map(({ v, n }) => ({ codigo: v.codigo, severidade: v.severidade, quantidade: n, exemplo: v.mensagem })),
      faltas: r.cobertura.filter((c) => c.falta > 0).slice(0, MAX_FALTAS), pessoas: r.pessoas,
      turnos: turnos.map((t) => ({ id: t.id, nome: t.nome })), grade: { dias, linhas: linhasGrade },
    };
  } catch (e) {
    if (e instanceof ErroAdequacao) return { ok: false, erro: e.message };
    if (e instanceof ErroServico) return { ok: false, erro: /permission|sem permiss|row-level/i.test(e.message) ? 'Você não tem permissão para esta ação.' : e.message };
    return { ok: false, erro: 'Não foi possível gerar a alocação agora. Tente de novo.' };
  }
}
