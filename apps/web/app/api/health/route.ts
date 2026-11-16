/** Verificação de saúde do container (Railway): sem autenticação e sem tocar no banco. */
export const dynamic = 'force-dynamic';

export function GET() {
  // Só informa se as variáveis do build existem (nunca os valores): ajuda a diagnosticar "Internal Server Error".
  const configurado = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  };
  const ok = configurado.NEXT_PUBLIC_SUPABASE_URL && configurado.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Response.json({ ok, servico: 'web', configurado }, { status: 200, headers: { 'cache-control': 'no-store' } });
}
