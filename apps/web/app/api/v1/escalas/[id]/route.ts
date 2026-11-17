import { gerarEscalaPdf, gerarEscalaXlsx } from '@jc/documents';
import { dataDeInstante } from '@jc/rules-engine';
import { carregarEntradaEscala } from '@jc/servicos';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { montarDadosEscala, nomeArquivoEscala } from '@/lib/escala-export';
import { supabaseServidor } from '@/lib/supabase/server';

const TIPOS = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

/** Escala em PDF (para afixar) ou Excel. Usa o cliente do usuário: o RLS decide quem pode ver a escala. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  const formato = z.enum(['pdf', 'xlsx']).safeParse(new URL(req.url).searchParams.get('formato') ?? 'pdf');
  if (!id.success || !formato.success) return NextResponse.json({ erro: 'pedido inválido' }, { status: 400 });
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  let entrada;
  try { entrada = await carregarEntradaEscala(supabase, id.data); } catch { return NextResponse.json({ erro: 'não encontrada' }, { status: 404 }); }
  const [{ data: emp }, { data: esc }, { data: set }, { data: mod }] = await Promise.all([
    supabase.from('empresa').select('razao_social, cnpj').eq('id', entrada.escala.empresaId).maybeSingle(),
    supabase.from('escala').select('hash_publicado').eq('id', id.data).maybeSingle(),
    entrada.escala.setorId ? supabase.from('setor').select('nome').eq('id', entrada.escala.setorId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('turno_modelo').select('id, nome').eq('empresa_id', entrada.escala.empresaId),
  ]);
  const empresa = emp as { razao_social: string; cnpj: string } | null;
  if (!empresa) return NextResponse.json({ erro: 'não encontrada' }, { status: 404 });
  const dados = montarDadosEscala(entrada, {
    empresa: { razaoSocial: empresa.razao_social, cnpj: empresa.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') },
    setor: (set as { nome: string } | null)?.nome ?? null, hash: (esc as { hash_publicado: string | null } | null)?.hash_publicado ?? null,
    geradoEm: dataDeInstante(new Date()), nomesModelos: Object.fromEntries((Array.isArray(mod) ? (mod as { id: string; nome: string }[]) : []).map((m) => [m.id, m.nome])),
  });
  const bytes = formato.data === 'pdf' ? await gerarEscalaPdf(dados) : await gerarEscalaXlsx(dados);
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'content-type': TIPOS[formato.data], 'content-disposition': `attachment; filename="${nomeArquivoEscala(empresa.razao_social, entrada.escala.inicio, entrada.escala.versao, formato.data)}"`, 'cache-control': 'no-store' },
  });
}
