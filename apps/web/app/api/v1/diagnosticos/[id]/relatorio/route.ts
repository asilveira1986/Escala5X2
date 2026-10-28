import { gerarRelatorioPdf, gerarRelatorioXlsx, MARCA_PADRAO, corValida, type Marca } from '@jc/documents';
import { dataDeInstante } from '@jc/rules-engine';
import { carregarDiagnostico, ErroServico } from '@jc/servicos';
import { z } from 'zod';
import { supabaseServidor } from '@/lib/supabase/server';
import type { EmpresaRow, OrganizacaoRow } from '@/lib/tipos-db';

export const runtime = 'nodejs';
const LOGO_MAX = 1024 * 1024;

const ehPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const ehJpg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  const formato = z.enum(['pdf', 'xlsx']).safeParse(new URL(req.url).searchParams.get('formato'));
  if (!id.success || !formato.success) return new Response('Requisição inválida', { status: 400 });

  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autenticado', { status: 401 });

  let salvo;
  try {
    salvo = await carregarDiagnostico(supabase, id.data);
  } catch (e) {
    if (e instanceof ErroServico) return new Response('Não encontrado', { status: 404 });
    throw e;
  }
  const { data: emp } = await supabase.from('empresa').select('id, razao_social, cnpj').eq('id', salvo.empresaId).maybeSingle();
  const empresa = emp as Pick<EmpresaRow, 'id' | 'razao_social' | 'cnpj'> | null;
  if (!empresa) return new Response('Não encontrado', { status: 404 });

  // White label: usa a marca do escritório contábil do usuário, se houver; senão a padrão.
  const { data: orgs } = await supabase.from('organizacao').select('id, nome, tipo, white_label').eq('tipo', 'contabilidade').limit(1);
  const org = (orgs as OrganizacaoRow[] | null)?.[0];
  const marca: Marca = { ...MARCA_PADRAO };
  if (org) {
    marca.nome = org.white_label?.nome?.slice(0, 80) || org.nome;
    if (org.white_label?.cor && corValida(org.white_label.cor)) marca.corPrimaria = org.white_label.cor;
    const caminho = org.white_label?.logo_path;
    if (caminho && caminho.startsWith(`${org.id}/`)) {
      const baixado = await supabase.storage.from('marca').download(caminho);
      if (baixado.data && baixado.data.size <= LOGO_MAX) {
        const bytes = new Uint8Array(await baixado.data.arrayBuffer());
        if (ehPng(bytes) || ehJpg(bytes)) marca.logo = bytes;
      }
    }
  }

  // Exportar é um evento auditável; se não conseguir registrar, não entrega o arquivo.
  const { error: errAud } = await supabase.rpc('registrar_exportacao', { p_diagnostico: id.data, p_formato: formato.data });
  if (errAud) return new Response('Sem permissão para exportar', { status: 403 });

  const dados = {
    empresa: { razaoSocial: empresa.razao_social, cnpj: empresa.cnpj }, geradoEm: dataDeInstante(new Date()), marca, diagnostico: salvo.diagnostico,
    cenarios: salvo.cenarios.filter((c) => c.resultado).map((c) => ({ nome: c.nome, resultado: c.resultado! })),
  };
  const corpo = formato.data === 'pdf' ? await gerarRelatorioPdf(dados) : await gerarRelatorioXlsx(dados);
  const nomeSeguro = empresa.razao_social.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'empresa';
  return new Response(corpo as BodyInit, {
    headers: {
      'content-type': formato.data === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="diagnostico-5x2-${nomeSeguro}.${formato.data}"`,
      'cache-control': 'private, no-store',
    },
  });
}
