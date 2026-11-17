'use server';

import { lancarBancoPonto } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { calcularApuracao } from '@/lib/banco-ponto-dados';
import { exigirUsuario } from '@/lib/contexto';

export type ResultadoApuracao = { ok: true; lancados: number; recusados: { colaboradorId: string; data: string; motivo: string }[] } | { ok: false; erro: string };
const selecao = z.array(z.object({ colaboradorId: z.string().uuid(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).min(1, 'Marque pelo menos um dia.').max(2000);

/**
 * Lança no banco de horas os dias marcados. Os minutos NÃO vêm do navegador: o servidor refaz a apuração pelo ponto e só
 * aproveita, entre os dias pedidos, os que ela propõe e que ainda não foram lançados.
 */
export async function lancarApuracao(empresaId: string, mes: string, dias: { colaboradorId: string; data: string }[]): Promise<ResultadoApuracao> {
  const e = z.string().uuid().safeParse(empresaId);
  const m = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(mes);
  const s = selecao.safeParse(dias);
  if (!e.success || !m.success) return { ok: false, erro: 'Pedido inválido.' };
  if (!s.success) return { ok: false, erro: s.error.issues[0]?.message ?? 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  try {
    const ap = await calcularApuracao(supabase, e.data, m.data);
    if (!ap.completo) return { ok: false, erro: 'Não foi possível ler todos os dados do mês. Recarregue a página e tente de novo.' };
    const pedidos = new Set(s.data.map((d) => `${d.colaboradorId}|${d.data}`));
    const alvo = ap.itens.filter((i) => !i.jaLancado && pedidos.has(`${i.colaboradorId}|${i.data}`));
    if (alvo.length === 0) return { ok: false, erro: 'Nenhum dos dias marcados está disponível para lançar (já lançados ou sem diferença no ponto).' };
    const r = await lancarBancoPonto(supabase, e.data, alvo);
    revalidatePath(`/empresas/${e.data}/banco-horas`);
    revalidatePath(`/empresas/${e.data}/banco-horas/ponto`);
    return { ok: true, ...r };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    return { ok: false, erro: /sem permiss/i.test(msg) ? 'Você não tem permissão para lançar no banco de horas desta empresa.' : 'Não foi possível lançar agora. Tente de novo.' };
  }
}
