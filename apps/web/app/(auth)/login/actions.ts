'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { supabaseServidor } from '@/lib/supabase/server';

const credenciais = z.object({ email: z.string().email(), senha: z.string().min(8) });

export type EstadoLogin = { erro?: string; enviado?: boolean };

export async function entrarComSenha(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const dados = credenciais.safeParse({ email: form.get('email'), senha: form.get('senha') });
  if (!dados.success) return { erro: 'Informe um e-mail válido e senha com ao menos 8 caracteres.' };
  const supabase = await supabaseServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: dados.data.email, password: dados.data.senha });
  if (error) return { erro: 'E-mail ou senha inválidos.' };
  redirect('/');
}

export async function enviarLinkMagico(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = z.string().email().safeParse(form.get('email'));
  if (!email.success) return { erro: 'Informe um e-mail válido.' };
  const supabase = await supabaseServidor();
  const origem = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${origem}/auth/callback` },
  });
  if (error) return { erro: 'Não foi possível enviar o link. Tente novamente.' };
  return { enviado: true };
}
