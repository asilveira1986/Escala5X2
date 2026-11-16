import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

/**
 * Envia o link de acesso a OUTRA pessoa (o colaborador convidado). Usa um cliente sem sessão e sem cookies,
 * para não mexer na sessão de quem convida. O link do e-mail é confirmado em /auth/confirmar (token_hash).
 */
export async function enviarLinkDeAcesso(email: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const e = env();
  const cliente = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const origem = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const { error } = await cliente.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${origem}/auth/confirmar` } });
  return error ? { ok: false, erro: error.message } : { ok: true };
}
