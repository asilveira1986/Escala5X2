import { errosParaCsv } from '@jc/connectors';
import { z } from 'zod';
import { supabaseServidor } from '@/lib/supabase/server';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return new Response('Não encontrado', { status: 404 });
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autenticado', { status: 401 });
  const { data } = await supabase.from('importacao').select('relatorio').eq('id', id.data).maybeSingle();
  const erros = (data as { relatorio: { erros?: Parameters<typeof errosParaCsv>[0] } | null } | null)?.relatorio?.erros;
  if (!erros) return new Response('Não encontrado', { status: 404 });
  return new Response(errosParaCsv(erros), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="erros-importacao.csv"', 'cache-control': 'private, no-store' },
  });
}
