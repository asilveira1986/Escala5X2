'use server';

import { aprovarAusencia, aprovarTroca, preverSolicitacao, recusarSolicitacao, type SolicitacaoLinha } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { supabaseServidorRestrito } from '@/lib/supabase/servidor-restrito';

export type ResultadoDecisao = { ok: true; mensagem: string } | { ok: false; erro: string };
const ids = z.object({ empresaId: z.string().uuid(), id: z.string().uuid() });

async function carregar(supabase: Awaited<ReturnType<typeof exigirUsuario>>['supabase'], empresaId: string, id: string): Promise<SolicitacaoLinha | null> {
  const { data } = await supabase.from('solicitacao').select('*').eq('id', id).eq('empresa_id', empresaId).maybeSingle();
  return (data as SolicitacaoLinha | null) ?? null;
}

export async function aprovarPedido(empresaId: string, id: string): Promise<ResultadoDecisao> {
  const p = ids.safeParse({ empresaId, id });
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase, user } = await exigirUsuario();
  const s = await carregar(supabase, p.data.empresaId, p.data.id);
  if (!s) return { ok: false, erro: 'Pedido não encontrado.' };
  if (s.status !== 'pendente') return { ok: false, erro: 'Este pedido não está pendente de decisão.' };
  const r = s.tipo === 'ferias' || s.tipo === 'afastamento'
    ? await aprovarAusencia(supabase, s, (await preverSolicitacao(supabase, s)).conflitos)
    : await aprovarTroca(supabase, supabaseServidorRestrito(), s, user.id);
  revalidatePath(`/empresas/${p.data.empresaId}/solicitacoes`);
  revalidatePath(`/empresas/${p.data.empresaId}/escalas`);
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true, mensagem: r.relatorio.resumo };
}

export async function recusarPedido(empresaId: string, id: string, motivo: string): Promise<ResultadoDecisao> {
  const p = ids.safeParse({ empresaId, id });
  const m = z.string().trim().min(3, 'Informe o motivo da recusa.').max(300).safeParse(motivo);
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  if (!m.success) return { ok: false, erro: m.error.issues[0]?.message ?? 'Informe o motivo da recusa.' };
  const { supabase } = await exigirUsuario();
  const r = await recusarSolicitacao(supabase, p.data.id, m.data);
  revalidatePath(`/empresas/${p.data.empresaId}/solicitacoes`);
  return r.ok ? { ok: true, mensagem: 'Pedido recusado.' } : { ok: false, erro: r.erro };
}
