import { gerarComunicadosPdf, MAX_COMUNICADOS_PDF } from '@jc/documents';
import { dataDeInstante, diagnosticar } from '@jc/rules-engine';
import { chamar, lerEntradaDiagnostico } from '@jc/servicos';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { selecionarComunicados } from '@/lib/comunicados';
import { supabaseServidor } from '@/lib/supabase/server';

/** Comunicados de adequação de jornada em PDF (uma página por colaborador afetado). Só quem gere a empresa; o RLS decide o que cada um vê. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sp = new URL(req.url).searchParams;
  const id = z.string().uuid().safeParse((await params).id);
  const fase = z.enum(['F1', 'F2']).safeParse(sp.get('fase'));
  const setor = sp.get('setor');
  if (!id.success || !fase.success || (setor !== null && setor.length > 80)) return NextResponse.json({ erro: 'pedido inválido' }, { status: 400 });
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  const { data: gere } = await supabase.rpc('pode_gerir_empresa', { p_empresa: id.data });
  if (gere !== true) return NextResponse.json({ erro: 'sem permissão' }, { status: 403 });
  const hoje = dataDeInstante(new Date());
  try {
    const [entrada, { data: emp }] = await Promise.all([
      chamar(supabase, 'diagnostico_entrada', { p_empresa: id.data, p_data: hoje }).then(lerEntradaDiagnostico),
      supabase.from('empresa').select('razao_social, cnpj').eq('id', id.data).maybeSingle(),
    ]);
    const empresa = emp as { razao_social: string; cnpj: string } | null;
    if (!empresa) return NextResponse.json({ erro: 'não encontrada' }, { status: 404 });
    const sel = selecionarComunicados(diagnosticar(entrada.colaboradores, hoje, entrada.regras), entrada.regras, fase.data, setor);
    if (!sel) return NextResponse.json({ erro: 'fase não cadastrada' }, { status: 409 });
    if (sel.itens.length === 0) return NextResponse.json({ erro: 'ninguém a adequar nesta fase' }, { status: 404 });
    if (sel.itens.length > MAX_COMUNICADOS_PDF) return NextResponse.json({ erro: `muitos colaboradores para um PDF (máximo ${MAX_COMUNICADOS_PDF}); filtre por setor` }, { status: 413 });
    const bytes = await gerarComunicadosPdf({
      empresa: { razaoSocial: empresa.razao_social, cnpj: empresa.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') },
      ...sel, geradoEm: hoje,
    });
    const nome = `comunicados-${fase.data === 'F1' ? 'fase1' : 'fase2'}${setor ? `-${setor.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase()}` : ''}.pdf`;
    return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${nome}"`, 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ erro: 'não foi possível gerar agora' }, { status: 500 });
  }
}
