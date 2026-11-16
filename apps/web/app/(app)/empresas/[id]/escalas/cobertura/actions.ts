'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { lerQuantidades, montarFaixa } from '@/lib/cobertura';

export type EstadoForm = { erro?: string; ok?: string };
const id = z.string().uuid();
const traduzir = (m: string) => (/row-level|permission/i.test(m) ? 'Você não tem permissão para alterar a cobertura desta empresa.' : /setor não pertence/.test(m) ? 'O setor escolhido não pertence a esta empresa.' : 'Não foi possível salvar. Confira os dados e tente de novo.');

export async function adicionarDemanda(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const empresaId = id.safeParse(form.get('empresaId'));
  const setorRaw = String(form.get('setorId') ?? '');
  const setor = setorRaw ? id.safeParse(setorRaw) : { success: true as const, data: null };
  const dias = [...new Set(form.getAll('dias').map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const faixa = montarFaixa(String(form.get('inicio') ?? ''), String(form.get('fim') ?? ''));
  const q = lerQuantidades(form.get('minimo'), form.get('ideal'));
  if (!empresaId.success || !setor.success) return { erro: 'Pedido inválido.' };
  if (dias.length === 0) return { erro: 'Marque pelo menos um dia da semana.' };
  if (!faixa) return { erro: 'Confira o horário: entrada e saída precisam ser diferentes.' };
  if (typeof q === 'string') return { erro: q };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.from('demanda_cobertura').insert(dias.map((d) => ({
    empresa_id: empresaId.data, setor_id: setor.data, dia_semana: d, faixa_inicio_min: faixa.inicioMin, faixa_fim_min: faixa.fimMin, minimo: q.minimo, ideal: q.ideal,
  })));
  if (error) return { erro: traduzir(error.message) };
  revalidatePath(`/empresas/${empresaId.data}/escalas/cobertura`);
  return { ok: `${dias.length === 1 ? 'Faixa adicionada' : `${dias.length} faixas adicionadas`}.` };
}

export async function removerDemanda(empresaId: string, demandaId: string): Promise<EstadoForm> {
  const e = id.safeParse(empresaId), d = id.safeParse(demandaId);
  if (!e.success || !d.success) return { erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { error, count } = await supabase.from('demanda_cobertura').delete({ count: 'exact' }).eq('id', d.data).eq('empresa_id', e.data);
  if (error || !count) return { erro: error ? traduzir(error.message) : 'Você não tem permissão para remover esta faixa.' };
  revalidatePath(`/empresas/${e.data}/escalas/cobertura`);
  return { ok: 'Faixa removida.' };
}
