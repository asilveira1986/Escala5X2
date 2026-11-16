'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { enviarLinkDeAcesso } from '@/lib/supabase/envio-link';

export type ResultadoAcesso = { ok: true; mensagem: string } | { ok: false; erro: string };
const ids = z.object({ empresaId: z.string().uuid(), colaboradorId: z.string().uuid() });
const traduzir = (m: string) => (/sem permiss/i.test(m) ? 'Você não tem permissão para esta ação.' : m);

export async function convidar(empresaId: string, colaboradorId: string, email: string): Promise<ResultadoAcesso> {
  const p = ids.safeParse({ empresaId, colaboradorId });
  const e = z.string().trim().email('Informe um e-mail válido.').safeParse(email);
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  if (!e.success) return { ok: false, erro: 'Informe um e-mail válido.' };
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.rpc('convidar_colaborador', { p_colaborador: p.data.colaboradorId, p_email: e.data });
  if (error) return { ok: false, erro: traduzir(error.message) };
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores`);
  const estado = (data as { estado?: string } | null)?.estado;
  if (estado === 'vinculado') return { ok: true, mensagem: 'Esse e-mail já tinha conta. O acesso foi liberado: basta a pessoa entrar para ver a escala.' };
  const envio = await enviarLinkDeAcesso(e.data.toLowerCase());
  return envio.ok
    ? { ok: true, mensagem: `Convite enviado para ${e.data.toLowerCase()}. O vínculo é feito quando a pessoa abrir o link.` }
    : { ok: true, mensagem: 'Convite registrado, mas o e-mail não pôde ser enviado agora (o limite de envios do Supabase pode ter sido atingido). Tente reenviar em alguns minutos.' };
}

export async function revogarAcesso(empresaId: string, colaboradorId: string): Promise<ResultadoAcesso> {
  const p = ids.safeParse({ empresaId, colaboradorId });
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('revogar_acesso_colaborador', { p_colaborador: p.data.colaboradorId });
  if (error) return { ok: false, erro: traduzir(error.message) };
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores`);
  return { ok: true, mensagem: 'Acesso removido.' };
}
