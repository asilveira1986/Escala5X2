import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { decidirAcesso } from './lib/acesso';
import { env } from './lib/env';
import { hashUsuario } from './lib/pwa/uid';

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const e = env();
  const supabase = createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  const destino = decidirAcesso({ caminho: req.nextUrl.pathname, autenticado: !!user });
  if (destino) return NextResponse.redirect(new URL(destino, req.url));
  // Marca as respostas autenticadas com o usuário: o service worker só serve a cópia offline à mesma pessoa.
  if (user) res.headers.set('x-jc-uid', await hashUsuario(user.id));
  return res;
}

export const config = { // api/health: verificação de saúde do Railway, sem login
// Fora do login: arquivos estáticos, verificação de saúde e tudo o que o navegador busca antes de entrar (PWA).
matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks/|manifest.webmanifest|icons/|icon|apple-icon|sw.js|sw-core.js|offline).*)'] };
