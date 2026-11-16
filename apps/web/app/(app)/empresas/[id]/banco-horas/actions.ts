'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { lerDuracao, TIPOS_LANCAMENTO } from '@/lib/banco-horas-ui';

export type Resultado = { ok: true; mensagem: string } | { ok: false; erro: string };
const uuid = z.string().uuid();
const traduzir = (m: string) => (/sem permiss/i.test(m) ? 'Você não tem permissão para esta ação.' : /^(duplicate|new row|violates|insert|update|select|permission)/i.test(m) ? 'Não foi possível salvar. Confira os dados.' : m);

const entradaZ = z.object({
  empresaId: uuid, colaboradorId: uuid, tipo: z.enum(['manual', 'compensacao', 'falta', 'pagamento', 'ajuste']), sinal: z.union([z.literal(1), z.literal(-1)]),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data.'), duracao: z.string(), descricao: z.string().trim().max(300).optional(),
});
export type NovoLancamento = z.input<typeof entradaZ>;

export async function lancar(entrada: NovoLancamento): Promise<Resultado> {
  const p = entradaZ.safeParse(entrada);
  if (!p.success) return { ok: false, erro: p.error.issues[0]?.message ?? 'Pedido inválido.' };
  const d = p.data;
  if (!TIPOS_LANCAMENTO.some((t) => t.id === d.tipo && t.sinal === d.sinal)) return { ok: false, erro: 'Tipo de lançamento inválido.' };
  const min = lerDuracao(d.duracao);
  if (min == null) return { ok: false, erro: 'Informe a duração como horas e minutos (por exemplo 02:30), de 1 minuto a 24 horas.' };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('lancar_banco_horas', { p_colaborador: d.colaboradorId, p_data: d.data, p_minutos: d.sinal * min, p_origem: d.tipo, p_descricao: d.descricao || null });
  if (error) return { ok: false, erro: traduzir(error.message) };
  revalidatePath(`/empresas/${d.empresaId}/banco-horas`);
  return { ok: true, mensagem: 'Lançamento registrado.' };
}

export async function estornar(empresaId: string, id: number, motivo: string): Promise<Resultado> {
  const e = uuid.safeParse(empresaId);
  const m = z.string().trim().min(3, 'Informe o motivo do estorno.').max(300).safeParse(motivo);
  if (!e.success || !Number.isInteger(id)) return { ok: false, erro: 'Pedido inválido.' };
  if (!m.success) return { ok: false, erro: m.error.issues[0]?.message ?? 'Informe o motivo do estorno.' };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('estornar_banco_horas', { p_id: id, p_motivo: m.data });
  if (error) return { ok: false, erro: traduzir(error.message) };
  revalidatePath(`/empresas/${e.data}/banco-horas`);
  return { ok: true, mensagem: 'Lançamento estornado.' };
}
