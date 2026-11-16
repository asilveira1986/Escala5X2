'use server';

import { calcularFechamento, carregarBaseFechamento, fecharFolha, podeFechar } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { mesEncerrado } from '@/lib/folha-ui';
import { dataDeInstante } from '@jc/rules-engine';

export type ResultadoFechamento = { ok: true; mensagem: string } | { ok: false; erro: string };

/** Recalcula no servidor (nada vem do navegador além do mês e do motivo) e fecha. */
export async function fecharMes(empresaId: string, mes: string, motivo: string): Promise<ResultadoFechamento> {
  const e = z.string().uuid().safeParse(empresaId);
  const m = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(mes);
  const mo = z.string().trim().max(300).safeParse(motivo ?? '');
  if (!e.success || !m.success || !mo.success) return { ok: false, erro: 'Pedido inválido.' };
  if (!mesEncerrado(m.data, dataDeInstante(new Date()))) return { ok: false, erro: 'Só dá para fechar um mês já encerrado.' };
  const { supabase } = await exigirUsuario();
  try {
    const { base, entradas } = await carregarBaseFechamento(supabase, e.data, `${m.data}-01`);
    const f = calcularFechamento(base, entradas);
    if (!podeFechar(f)) return { ok: false, erro: f.avisos.find((a) => a.severidade === 'bloqueio')?.mensagem ?? 'Este mês não pode ser fechado.' };
    if (base.versao_vigente != null && mo.data.length < 5) return { ok: false, erro: 'Este mês já foi fechado. Informe o motivo da reabertura (mínimo de 5 caracteres).' };
    await fecharFolha(supabase, e.data, f, mo.data || undefined);
    revalidatePath(`/empresas/${e.data}/folha`);
    return { ok: true, mensagem: base.versao_vigente != null ? `Mês refechado (versão ${base.versao_vigente + 1}).` : 'Mês fechado.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    return { ok: false, erro: /sem permiss|permission|row-level/i.test(msg) ? 'Você não tem permissão para fechar a folha desta empresa.' : msg && !/^(duplicate|new row|violates|insert|update|select)/i.test(msg) ? msg : 'Não foi possível fechar o mês.' };
  }
}
