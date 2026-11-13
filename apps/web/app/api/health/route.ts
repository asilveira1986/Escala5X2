/** Verificação de saúde do container (Railway): responde sem autenticação e sem tocar no banco. */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, servico: 'web' }, { headers: { 'cache-control': 'no-store' } });
}
