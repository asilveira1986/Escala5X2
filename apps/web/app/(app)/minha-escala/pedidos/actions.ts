'use server';

import { ErroServico } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';

export type Resultado = { ok: true } | { ok: false; erro: string };
const uuid = z.string().uuid();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const motivo = z.string().trim().max(300, 'O motivo pode ter até 300 caracteres.').optional();

const pedidoZ = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('troca_turno'), colaboradorId: uuid, escalaId: uuid, dataSolicitante: data, dataColega: data, destinatarioId: uuid, motivo }),
  z.object({ tipo: z.literal('troca_folga'), colaboradorId: uuid, escalaId: uuid, trabalharEm: data, folgarEm: data, motivo }),
  z.object({ tipo: z.enum(['ferias', 'afastamento']), colaboradorId: uuid, inicio: data, fim: data, motivo }),
]);
export type NovoPedido = z.input<typeof pedidoZ>;

/** As mensagens do banco são em português e feitas para a pessoa; erro de permissão ganha texto próprio. */
const traduzir = (e: unknown): string => {
  const m = e instanceof ErroServico ? e.message : (e as { message?: string })?.message ?? '';
  if (/sem permiss/i.test(m)) return 'Você não tem permissão para esta ação.';
  return m && !/^(duplicate|new row|violates|insert|update|select)/i.test(m) ? m : 'Não foi possível concluir. Tente novamente.';
};

export async function criarPedido(entrada: NovoPedido): Promise<Resultado> {
  const p = pedidoZ.safeParse(entrada);
  if (!p.success) return { ok: false, erro: p.error.issues[0]?.message ?? 'Pedido inválido.' };
  const d = p.data;
  const { supabase } = await exigirUsuario();
  const payload = d.tipo === 'troca_turno' ? { escalaId: d.escalaId, dataSolicitante: d.dataSolicitante, dataColega: d.dataColega }
    : d.tipo === 'troca_folga' ? { escalaId: d.escalaId, trabalharEm: d.trabalharEm, folgarEm: d.folgarEm } : { inicio: d.inicio, fim: d.fim };
  const { error } = await supabase.rpc('criar_solicitacao', {
    p_colaborador: d.colaboradorId, p_tipo: d.tipo, p_payload: payload, p_destinatario: d.tipo === 'troca_turno' ? d.destinatarioId : null, p_motivo: d.motivo || null,
  });
  if (error) return { ok: false, erro: traduzir(error) };
  revalidatePath('/minha-escala/pedidos');
  return { ok: true };
}

export async function responderPedido(id: string, aceita: boolean): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('responder_solicitacao', { p_id: id, p_aceita: aceita });
  if (error) return { ok: false, erro: traduzir(error) };
  revalidatePath('/minha-escala/pedidos');
  return { ok: true };
}

export async function cancelarPedido(id: string): Promise<Resultado> {
  if (!uuid.safeParse(id).success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('cancelar_solicitacao', { p_id: id });
  if (error) return { ok: false, erro: traduzir(error) };
  revalidatePath('/minha-escala/pedidos');
  return { ok: true };
}
