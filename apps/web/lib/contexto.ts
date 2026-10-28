import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { supabaseServidor } from './supabase/server';

export async function exigirUsuario() {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { supabase, user };
}

const uuid = z.string().uuid();
/** Parâmetro de rota inválido vira 404 em vez de erro de banco. */
export function idOu404(valor: string): string {
  const r = uuid.safeParse(valor);
  if (!r.success) notFound();
  return r.data;
}

/** Linhas do PostgREST sem tipos gerados: converte de forma explícita e localizada. */
export function linhas<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}
