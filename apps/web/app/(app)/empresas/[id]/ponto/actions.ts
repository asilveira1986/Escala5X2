'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';

export type Resultado = { ok: true; mensagem: string } | { ok: false; erro: string };
const uuid = z.string().uuid();
const traduzir = (m: string) => (/sem permiss/i.test(m) ? 'Você não tem permissão para esta ação.' : /^(duplicate|new row|violates|insert|update|select|permission)/i.test(m) ? 'Não foi possível concluir. Tente novamente.' : m);

export async function vincularIdentificador(empresaId: string, tipo: string, hash: string, colaboradorId: string): Promise<Resultado> {
  const e = uuid.safeParse(empresaId), c = uuid.safeParse(colaboradorId), t = z.enum(['pis', 'cpf']).safeParse(tipo), h = z.string().regex(/^[0-9a-f]{64}$/).safeParse(hash);
  if (!e.success || !c.success || !t.success || !h.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.rpc('mapear_identificador_ponto', { p_empresa: e.data, p_tipo: t.data, p_hash: h.data, p_colaborador: c.data });
  if (error) return { ok: false, erro: traduzir(error.message) };
  revalidatePath(`/empresas/${e.data}/ponto`);
  return { ok: true, mensagem: `${Number(data) || 0} marcação(ões) vinculada(s). As próximas importações já reconhecem este identificador.` };
}

export async function desfazerImportacao(empresaId: string, importacaoId: string, motivo: string): Promise<Resultado> {
  const e = uuid.safeParse(empresaId), i = uuid.safeParse(importacaoId), m = z.string().trim().min(5, 'Informe o motivo (mínimo 5 caracteres).').max(300).safeParse(motivo);
  if (!e.success || !i.success) return { ok: false, erro: 'Pedido inválido.' };
  if (!m.success) return { ok: false, erro: m.error.issues[0]?.message ?? 'Informe o motivo.' };
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.rpc('desfazer_importacao_afd', { p_importacao: i.data, p_motivo: m.data });
  if (error) return { ok: false, erro: traduzir(error.message) };
  revalidatePath(`/empresas/${e.data}/ponto`);
  return { ok: true, mensagem: `Importação desfeita (${Number(data) || 0} marcação(ões) removida(s)).` };
}
