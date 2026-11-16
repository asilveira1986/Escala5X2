import { createHash } from 'node:crypto';
import { decodificarAfd, lerAfd, parseCnpj } from '@jc/connectors';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServidor } from '@/lib/supabase/server';

const MAX_BYTES = 10 * 1024 * 1024;
const LOTE = 4000;

/**
 * Importa um AFD (marcações do relógio de ponto). O arquivo é lido AQUI, no servidor; o banco recebe só as marcações
 * (CPF/PIS viram hash lá dentro) e confere permissão em cada passo. Por padrão recusa o arquivo inteiro se houver linha
 * fora do leiaute (um AFD com linhas perdidas esconde marcações); `parcial=1` importa o que estiver válido e lista o resto.
 */
export async function POST(req: Request) {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ erro: 'Envie o arquivo como formulário (multipart).' }, { status: 400 }); }
  const empresaId = z.string().uuid().safeParse(form.get('empresaId'));
  const arquivo = form.get('arquivo');
  const parcial = form.get('parcial') === '1';
  if (!empresaId.success) return NextResponse.json({ erro: 'Empresa inválida.' }, { status: 400 });
  if (!(arquivo instanceof File) || arquivo.size === 0) return NextResponse.json({ erro: 'Selecione o arquivo AFD (.txt).' }, { status: 400 });
  if (arquivo.size > MAX_BYTES) return NextResponse.json({ erro: 'O arquivo passa de 10 MB. Gere o AFD de um período menor.' }, { status: 413 });

  const { data: gere } = await supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId.data });
  if (gere !== true) return NextResponse.json({ erro: 'Você não tem permissão para importar ponto desta empresa.' }, { status: 403 });
  const { data: emp } = await supabase.from('empresa').select('cnpj').eq('id', empresaId.data).maybeSingle();

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  const r = lerAfd(decodificarAfd(bytes));
  const erros = r.erros.slice(0, 50);
  if (!r.valido) return NextResponse.json({ erro: 'O arquivo não pôde ser lido como AFD.', erros, avisos: r.avisos }, { status: 422 });
  if (r.erros.length > 0 && !parcial) {
    return NextResponse.json({ erro: `O arquivo tem ${r.erros.length} linha(s) fora do leiaute. Corrija o arquivo ou confirme a importação parcial.`, erros, avisos: r.avisos, podeParcial: true }, { status: 422 });
  }
  // o arquivo precisa ser da empresa escolhida (cabeçalho com o CNPJ do empregador)
  const cnpjEmpresa = parseCnpj(String((emp as { cnpj?: string } | null)?.cnpj ?? ''));
  if (r.empregador?.tipoDocumento === 'cnpj' && cnpjEmpresa && r.empregador.documento !== cnpjEmpresa) {
    return NextResponse.json({ erro: 'O CNPJ do arquivo é diferente do CNPJ desta empresa. Confira se este é o AFD certo.', avisos: r.avisos }, { status: 422 });
  }

  const { data: id, error: eIni } = await supabase.rpc('iniciar_importacao_afd', { p_empresa: empresaId.data, p_nome: arquivo.name.slice(0, 200), p_hash: hash, p_dialeto: r.dialeto });
  if (eIni || typeof id !== 'string') return NextResponse.json({ erro: eIni?.message && !/^(duplicate|new row|violates)/i.test(eIni.message) ? eIni.message : 'Não foi possível iniciar a importação.' }, { status: 409 });

  let inseridas = 0, jaExistiam = 0;
  try {
    for (let i = 0; i < r.marcacoes.length; i += LOTE) {
      const lote = r.marcacoes.slice(i, i + LOTE).map((m) => ({ momento: m.momento, nsr: m.nsr, tipo: m.tipoIdentificador, identificador: m.identificador }));
      const { data, error } = await supabase.rpc('importar_marcacoes_afd', { p_importacao: id, p_marcacoes: lote });
      if (error) throw new Error(error.message);
      const j = data as { inseridas: number; jaExistiam: number };
      inseridas += j.inseridas; jaExistiam += j.jaExistiam;
    }
  } catch {
    // não deixa importação pela metade: desfaz o que entrou e registra a falha
    await supabase.rpc('desfazer_importacao_afd', { p_importacao: id, p_motivo: 'Falha durante a importação; nada foi mantido.' });
    return NextResponse.json({ erro: 'A importação falhou no meio e foi desfeita. Tente novamente.' }, { status: 500 });
  }

  const { data: pend } = await supabase.rpc('identificadores_pendentes', { p_empresa: empresaId.data });
  const naoReconhecidos = Array.isArray(pend) ? pend.length : 0;
  const relatorio = {
    dialeto: r.dialeto, linhas: r.resumo.linhas, marcacoesLidas: r.resumo.marcacoes, inseridas, jaExistiam, duplicadasNoArquivo: r.resumo.duplicadasNoArquivo,
    periodo: { inicio: r.resumo.primeiraData, fim: r.resumo.ultimaData }, identificadores: r.resumo.identificadores, ignoradosPorTipo: r.resumo.ignoradosPorTipo,
    errosTotal: r.erros.length, erros, avisos: r.avisos, parcial, naoReconhecidos,
  };
  const { error: eFim } = await supabase.rpc('finalizar_importacao_afd', { p_importacao: id, p_status: 'concluida', p_relatorio: relatorio });
  if (eFim) return NextResponse.json({ erro: 'As marcações entraram, mas não foi possível encerrar o registro da importação. Confira a lista de importações.' }, { status: 500 });
  return NextResponse.json({ ok: true, importacaoId: id, ...relatorio });
}
