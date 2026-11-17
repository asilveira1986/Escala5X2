import { NextResponse } from 'next/server';
import { supabaseServidor } from '@/lib/supabase/server';

const semCache = { 'cache-control': 'no-store' };

/** Notificações do usuário logado (o RLS já limita às dele). `?contagem=1` devolve só o número de não lidas. */
export async function GET(req: Request) {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401, headers: semCache });
  const sp = new URL(req.url).searchParams;
  const { count, error: ec } = await supabase.from('notificacao').select('id', { count: 'exact', head: true }).is('lida_em', null);
  if (ec) return NextResponse.json({ erro: 'indisponível' }, { status: 503, headers: semCache });
  if (sp.get('contagem') === '1') return NextResponse.json({ naoLidas: count ?? 0 }, { headers: semCache });
  const limite = Math.min(Math.max(Number(sp.get('limite')) || 20, 1), 100);
  const { data, error } = await supabase.from('notificacao').select('id, tipo, titulo, texto, href, criado_em, lida_em').order('criado_em', { ascending: false }).limit(limite);
  if (error) return NextResponse.json({ erro: 'indisponível' }, { status: 503, headers: semCache });
  return NextResponse.json({ naoLidas: count ?? 0, itens: data ?? [] }, { headers: semCache });
}
