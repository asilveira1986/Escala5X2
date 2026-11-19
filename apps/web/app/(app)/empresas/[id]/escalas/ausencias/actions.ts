'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { periodoAusencia } from '@/lib/cobertura';

export type EstadoForm = { erro?: string; ok?: string };
const id = z.string().uuid();

export async function adicionarAusencia(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const empresaId = id.safeParse(form.get('empresaId'));
  const colaboradorId = id.safeParse(form.get('colaboradorId'));
  const tipo = z.enum(['ferias', 'afastamento']).safeParse(form.get('tipo'));
  const obs = z.string().trim().max(200).safeParse(form.get('observacao') ?? '');
  const periodo = periodoAusencia(String(form.get('inicio') ?? ''), String(form.get('fim') ?? ''));
  if (!empresaId.success || !tipo.success || !obs.success) return { erro: 'Pedido inválido.' };
  if (!colaboradorId.success) return { erro: 'Escolha o colaborador.' };
  if (typeof periodo === 'string') return { erro: periodo };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.from('ausencia').insert({
    empresa_id: empresaId.data, colaborador_id: colaboradorId.data, tipo: tipo.data, periodo: periodo.texto, observacao: obs.data || null,
  });
  if (error) {
    if (/exclu|overlap|conflit/i.test(error.message)) return { erro: 'Este colaborador já tem férias ou afastamento que se sobrepõem a esse período.' };
    if (/row-level|permission/i.test(error.message)) return { erro: 'Você não tem permissão para lançar ausências nesta empresa.' };
    if (/não pertence/.test(error.message)) return { erro: 'O colaborador não pertence a esta empresa.' };
    return { erro: 'Não foi possível salvar a ausência.' };
  }
  revalidatePath(`/empresas/${empresaId.data}/escalas/ausencias`);
  redirect(`/empresas/${empresaId.data}/escalas/ausencias?lancada=1`);
}

export async function removerAusencia(empresaId: string, ausenciaId: string): Promise<{ erro?: string }> {
  const e = id.safeParse(empresaId), a = id.safeParse(ausenciaId);
  if (!e.success || !a.success) return { erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { error, count } = await supabase.from('ausencia').delete({ count: 'exact' }).eq('id', a.data).eq('empresa_id', e.data);
  if (error || !count) return { erro: 'Você não tem permissão para remover esta ausência.' };
  revalidatePath(`/empresas/${e.data}/escalas/ausencias`);
  revalidatePath(`/empresas/${e.data}/escalas/ausencias/${a.data}`);
  return {};
}
