import { createClient } from '@supabase/supabase-js';
import type { ClienteRpc } from '@jc/servicos';
import { env } from '../env';

/**
 * Cliente com a chave de serviço, SÓ para funções que o banco reserva ao servidor (ex.: publicar_escala).
 * A chave vem de SUPABASE_SERVICE_ROLE_KEY (sem prefixo NEXT_PUBLIC: nunca vai para o navegador).
 * Quem chama deve antes provar a permissão do usuário com o cliente dele (RLS).
 */
export function supabaseServidorRestrito(): ClienteRpc | null {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) return null;
  return createClient(env().NEXT_PUBLIC_SUPABASE_URL, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}
