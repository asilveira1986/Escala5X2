import { gerarFolhaCsv, gerarFolhaXlsx, type FolhaFechada } from '@jc/documents';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { nomeArquivo } from '@/lib/folha-ui';
import { supabaseServidor } from '@/lib/supabase/server';

type Linha = { id: string; empresa_id: string; competencia: string; versao: number; dados: FolhaFechada; criado_em: string; dados_hash: string };

/**
 * Arquivo do fechamento para a folha. Sai do retrato guardado (não recalcula), confere a integridade, registra a exportação
 * na auditoria e só funciona para quem gere a empresa (o RLS esconde o fechamento dos demais).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  const formato = z.enum(['csv', 'xlsx']).safeParse(new URL(req.url).searchParams.get('formato') ?? 'csv');
  if (!id.success || !formato.success) return NextResponse.json({ erro: 'pedido inválido' }, { status: 400 });
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data } = await supabase.from('fechamento_folha').select('id, empresa_id, competencia, versao, dados, criado_em, dados_hash').eq('id', id.data).maybeSingle();
  const f = data as Linha | null;
  if (!f) return NextResponse.json({ erro: 'não encontrado' }, { status: 404 });
  const { data: gere } = await supabase.rpc('pode_gerir_empresa', { p_empresa: f.empresa_id });
  if (gere !== true) return NextResponse.json({ erro: 'sem permissão' }, { status: 403 });
  const { data: integro } = await supabase.rpc('fechamento_integro', { p_id: f.id });
  if (integro !== true) return NextResponse.json({ erro: 'O fechamento não passou na conferência de integridade; o arquivo não foi gerado.' }, { status: 409 });
  const { data: emp } = await supabase.from('empresa').select('razao_social, cnpj').eq('id', f.empresa_id).maybeSingle();
  const empresa = (emp as { razao_social: string; cnpj: string } | null) ?? { razao_social: 'Empresa', cnpj: '' };

  const { error } = await supabase.rpc('registrar_exportacao_folha', { p_id: f.id, p_formato: formato.data, p_layout: 'generico' });
  if (error) return NextResponse.json({ erro: 'não foi possível registrar a exportação' }, { status: 500 });

  const mes = f.competencia.slice(0, 7);
  const nome = nomeArquivo(empresa.razao_social, mes, f.versao, formato.data);
  const cabecalhos = { 'content-disposition': `attachment; filename="${nome}"`, 'cache-control': 'no-store' };
  if (formato.data === 'csv') return new NextResponse(gerarFolhaCsv(f.dados), { headers: { ...cabecalhos, 'content-type': 'text/csv; charset=utf-8' } });
  const xlsx = await gerarFolhaXlsx(f.dados, { empresa: empresa.razao_social, cnpj: empresa.cnpj, versao: f.versao, hash: f.dados_hash, fechadoEm: f.criado_em });
  return new NextResponse(Buffer.from(xlsx), { headers: { ...cabecalhos, 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
}
