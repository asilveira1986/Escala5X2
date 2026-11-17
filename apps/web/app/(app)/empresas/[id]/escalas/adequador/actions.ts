'use server';

import { adequarEscala, carregarEntradaEscala, ErroAdequacao, ErroServico, type CoberturaDia, type FeriasNoPeriodo, type ResumoPessoa, type TurnoAdequacao } from '@jc/servicos';
import type { Violacao } from '@jc/rules-engine';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { paraGravacao } from '@/lib/escala-editor';
import { minutosDeHora } from '@/lib/adequador-ui';

const turnoZ = z.object({
  chave: z.string().min(1).max(40), nome: z.string().trim().min(1, 'Dê um nome a cada turno.').max(40),
  inicio: z.string(), fim: z.string(), intervalo: z.coerce.number().int().min(0).max(240), modeloId: z.string().uuid().nullable(),
});
const setorZ = z.object({
  setorId: z.string().uuid().nullable(), nome: z.string().trim().min(1).max(60),
  minimos: z.record(z.string(), z.array(z.coerce.number().int().min(0).max(500)).length(7)),
});
const pedidoZ = z.object({
  empresaId: z.string().uuid(), mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  diasPorSemana: z.number().int().min(1).max(6).nullable(),
  funcionamento: z.array(z.boolean()).length(7), fecharNosFeriados: z.boolean(),
  turnos: z.array(turnoZ).min(1, 'Informe pelo menos um turno.').max(6, 'No máximo 6 turnos.'),
  setores: z.array(setorZ).min(1, 'Escolha pelo menos um setor.').max(30),
  folgasFixas: z.record(z.string().uuid(), z.array(z.number().int().min(0).max(6)).max(3)),
});
export type PedidoGeracao = z.input<typeof pedidoZ>;

export type DadosSetor = {
  escalaId: string; revisao: number; criada: boolean;
  resumo: { necessarioTotal: number; alocadoTotal: number; faltaTotal: number; percentualAtendido: number; diasComFalta: number; pessoasAlocadas: number };
  avisos: string[]; bloqueios: number; alertas: number; violacoes: { codigo: string; severidade: string; quantidade: number; exemplo: string }[];
  faltas: CoberturaDia[]; pessoas: ResumoPessoa[]; diasFechados: string[]; ausencias: FeriasNoPeriodo[];
  turnos: { id: string; nome: string }[];
  grade: { dias: string[]; linhas: { colaboradorId: string; nome: string; celulas: string[] }[] };
};
export type ResultadoSetor = { setorId: string | null; setorNome: string } & ({ ok: true } & DadosSetor | { ok: false; erro: string });
export type ResultadoGeracao = { ok: true; setores: ResultadoSetor[] } | { ok: false; erro: string };

const MAX_FALTAS = 80;

/**
 * Gera a escala do mês, um setor por vez, a partir de turnos, dias de funcionamento, pessoas necessárias por setor/turno/dia,
 * folgas fixas e férias (as ausências cadastradas). Cada setor é GRAVADO num rascunho "Adequação AAAA-MM · Setor" que abre no editor.
 * Gerar de novo troca a alocação do rascunho; nunca mexe em escala publicada. Um setor com problema não impede os outros.
 */
export async function gerarEscalas(pedido: PedidoGeracao): Promise<ResultadoGeracao> {
  const p = pedidoZ.safeParse(pedido);
  if (!p.success) return { ok: false, erro: p.error.issues[0]?.message ?? 'Pedido inválido.' };
  const d = p.data;
  const base: Omit<TurnoAdequacao, 'minimo'>[] = [];
  for (const [i, t] of d.turnos.entries()) {
    const ini = minutosDeHora(t.inicio), f = minutosDeHora(t.fim);
    if (ini === null || f === null) return { ok: false, erro: `Horário inválido no turno ${t.nome}.` };
    base.push({ id: t.chave || `t${i + 1}`, nome: t.nome, inicioMin: ini, fimMin: f <= ini ? f + 1440 : f, intervaloMin: t.intervalo, modeloId: t.modeloId });
  }
  const { supabase, user } = await exigirUsuario();
  const [ano, m] = d.mes.split('-').map(Number) as [number, number];
  const proximo = m === 12 ? `${ano + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, '0')}-01`;
  const saida: ResultadoSetor[] = [];

  for (const setor of d.setores) {
    const id = { setorId: setor.setorId, setorNome: setor.nome };
    try {
      const turnos: TurnoAdequacao[] = base.map((t) => ({ ...t, minimo: setor.minimos[t.id] ?? Array(7).fill(0) }));
      const nome = `Adequação ${d.mes}${setor.setorId ? ` · ${setor.nome}` : ''}`.slice(0, 80);
      let q = supabase.from('escala').select('id').eq('empresa_id', d.empresaId).eq('status', 'rascunho').eq('nome', nome);
      q = setor.setorId ? q.eq('setor_id', setor.setorId) : q.is('setor_id', null);
      const { data: ex } = await q.limit(1);
      let escalaId = (Array.isArray(ex) ? (ex[0] as { id: string } | undefined)?.id : undefined) ?? null;
      let criada = false;
      if (!escalaId) {
        const { data: nova, error } = await supabase.from('escala').insert({ empresa_id: d.empresaId, setor_id: setor.setorId, nome, periodo: `[${d.mes}-01,${proximo})`, criado_por: user.id }).select('id').single();
        if (error || !nova) { saida.push({ ...id, ok: false, erro: /row-level|permission/i.test(error?.message ?? '') ? 'Você não tem permissão para criar escalas nesta empresa.' : 'Não foi possível criar o rascunho da escala.' }); continue; }
        escalaId = (nova as { id: string }).id; criada = true;
      }
      const entrada = await carregarEntradaEscala(supabase, escalaId);
      if (entrada.escala.empresaId !== d.empresaId) { saida.push({ ...id, ok: false, erro: 'Escala não encontrada.' }); continue; }
      const r = adequarEscala(entrada, {
        turnos, ...(d.diasPorSemana ? { diasPorSemana: d.diasPorSemana } : {}), diasFuncionamento: d.funcionamento, fecharNosFeriados: d.fecharNosFeriados, folgasFixas: d.folgasFixas,
      });
      const { data: rev, error: e2 } = await supabase.rpc('salvar_alocacoes', { p_escala: escalaId, p_revisao: entrada.escala.revisao, p_alocacoes: paraGravacao(r.alocacoes) });
      if (e2) { saida.push({ ...id, ok: false, erro: /permission|row-level/i.test(e2.message) ? 'Você não tem permissão para alterar esta escala.' : 'A alocação foi calculada, mas não foi possível gravá-la no rascunho. Tente de novo.' }); continue; }

      const porCodigo = new Map<string, { v: Violacao; n: number }>();
      for (const v of r.violacoes) { const k = `${v.codigo}|${v.severidade}`; const x = porCodigo.get(k); if (x) x.n++; else porCodigo.set(k, { v, n: 1 }); }
      const indiceTurno = new Map(turnos.map((t, i) => [t.id, i]));
      const dias = [...new Set(r.alocacoes.map((a) => a.data))].sort();
      const celula = new Map(r.alocacoes.map((a) => [`${a.colaboradorId}|${a.data}`, a]));
      saida.push({
        ...id, ok: true, escalaId, revisao: Number(rev), criada, resumo: r.resumo, avisos: r.avisos,
        bloqueios: r.violacoes.filter((v) => v.severidade === 'bloqueio').length, alertas: r.violacoes.filter((v) => v.severidade === 'alerta').length,
        violacoes: [...porCodigo.values()].sort((a, b) => (a.v.severidade === 'bloqueio' ? 0 : 1) - (b.v.severidade === 'bloqueio' ? 0 : 1) || b.n - a.n).slice(0, 12).map(({ v, n }) => ({ codigo: v.codigo, severidade: v.severidade, quantidade: n, exemplo: v.mensagem })),
        faltas: r.cobertura.filter((c) => c.falta > 0).slice(0, MAX_FALTAS), pessoas: r.pessoas, diasFechados: r.diasFechados, ausencias: r.ausencias,
        turnos: turnos.map((t) => ({ id: t.id, nome: t.nome })),
        grade: { dias, linhas: r.pessoas.map((pes) => ({ colaboradorId: pes.colaboradorId, nome: pes.nome, celulas: dias.map((dia) => { const a = celula.get(`${pes.colaboradorId}|${dia}`); return !a ? '' : a.tipo === 'trabalho' ? String(indiceTurno.get(r.turnoDe[pes.colaboradorId]!) ?? 0) : 'F'; }) })) },
      });
    } catch (e) {
      const erro = e instanceof ErroAdequacao ? e.message
        : e instanceof ErroServico ? (/permission|sem permiss|row-level/i.test(e.message) ? 'Você não tem permissão para esta ação.' : e.message)
        : 'Não foi possível gerar a escala deste setor agora. Tente de novo.';
      saida.push({ ...id, ok: false, erro });
    }
  }
  return { ok: true, setores: saida };
}
