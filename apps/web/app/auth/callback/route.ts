import { NextResponse } from 'next/server';
import { supabaseServidor } from '@/lib/supabase/server';

/** Retorno do link mágico e do login com Google (PKCE). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await supabaseServidor();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL('/login?erro=link', url.origin));
  }
  return NextResponse.redirect(new URL('/', url.origin));
}
