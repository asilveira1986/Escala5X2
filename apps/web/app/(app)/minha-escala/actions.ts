'use server';

import { ErroServico, registrarCiencia } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';

export type ResultadoCiencia = { ok: true } | { ok: false; erro: string };

export async function darCiencia(escalaId: string): Promise<ResultadoCiencia> {
  const id = z.string().uuid().safeParse(escalaId);
  if (!id.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  try {
    await registrarCiencia(supabase, id.data);
  } catch (e) {
    return { ok: false, erro: e instanceof ErroServico ? e.message : 'Não foi possível registrar sua ciência. Tente de novo.' };
  }
  revalidatePath('/minha-escala');
  return { ok: true };
}
