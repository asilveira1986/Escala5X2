import { NextResponse } from 'next/server';
import { lerMes, ordenarPorAtencao, paraCsv, type LinhaCarteira } from '@/lib/carteira';
import { supabaseServidor } from '@/lib/supabase/server';
import { dataDeInstante } from '@jc/rules-engine';

/** Planilha da carteira (CSV para Excel). Usa o cliente do usuário: o RLS decide quais empresas saem. */
export async function GET(req: Request) {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  const { data: gestao } = await supabase.rpc('minhas_organizacoes_gestao');
  if (!Array.isArray(gestao) || gestao.length === 0) return NextResponse.json({ erro: 'sem permissão' }, { status: 403 });
  const { mes, dia } = lerMes(new URL(req.url).searchParams.get('mes'), dataDeInstante(new Date()));
  const { data, error } = await supabase.rpc('painel_carteira', { p_mes: dia });
  if (error) return NextResponse.json({ erro: 'falha ao carregar' }, { status: 500 });
  return new NextResponse(paraCsv(ordenarPorAtencao((Array.isArray(data) ? data : []) as LinhaCarteira[])), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="carteira-${mes}.csv"`, 'cache-control': 'no-store' },
  });
}
