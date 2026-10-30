import { createBrowserClient } from '@supabase/ssr';
import { env } from '../env';

export function supabaseNavegador() {
  const e = env();
  return createBrowserClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
