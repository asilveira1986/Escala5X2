import { NextResponse } from 'next/server';
import { lerIdsLidas } from '@/lib/notificacoes';
import { supabaseServidor } from '@/lib/supabase/server';

const semCache = { 'cache-control': 'no-store' };

/** Marca como lidas: as de `ids` ou, sem lista, todas as do usuário. Só aceita pedido da própria origem. */
export async function POST(req: Request) {
  const origem = req.headers.get('origin');
  if (origem && new URL(origem).host !== req.headers.get('host')) return NextResponse.json({ erro: 'origem inválida' }, { status: 403, headers: semCache });
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401, headers: semCache });
  const corpo = await req.json().catch(() => null);
  const p = lerIdsLidas(corpo);
  if (!p.ok) return NextResponse.json({ erro: 'pedido inválido' }, { status: 400, headers: semCache });
  let q = supabase.from('notificacao').update({ lida_em: new Date().toISOString() }).is('lida_em', null);
  if (p.ids) q = q.in('id', p.ids);
  const { data, error } = await q.select('id');
  if (error) return NextResponse.json({ erro: 'indisponível' }, { status: 503, headers: semCache });
  return NextResponse.json({ marcadas: (data ?? []).length }, { headers: semCache });
}
