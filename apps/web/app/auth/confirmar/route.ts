import { NextResponse } from 'next/server';
import { supabaseServidor } from '@/lib/supabase/server';

const TIPOS = ['email', 'signup', 'magiclink', 'invite'] as const;
type Tipo = (typeof TIPOS)[number];

/**
 * Confirma o link enviado por e-mail (convite do colaborador). Diferente do retorno PKCE de /auth/callback, este
 * link funciona em qualquer aparelho, porque traz o token no próprio endereço (modelo de e-mail do Supabase:
 * {{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email). Não há parâmetro de destino: sempre vai para "/".
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get('token_hash');
  const tipo = url.searchParams.get('type');
  if (!tokenHash || !TIPOS.includes(tipo as Tipo)) return NextResponse.redirect(new URL('/login?erro=link', url.origin));
  const supabase = await supabaseServidor();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo as Tipo });
  if (error) return NextResponse.redirect(new URL('/login?erro=link', url.origin));
  return NextResponse.redirect(new URL('/', url.origin));
}
