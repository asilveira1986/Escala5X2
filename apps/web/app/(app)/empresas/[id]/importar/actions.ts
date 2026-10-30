'use server';

import { CAMPOS_COLABORADOR, camposObrigatoriosSemColuna, lerPlanilha, sugerirMapeamento, validarColaboradores, ErroPlanilha, LIMITES, type ErroLinha, type Mapeamento } from '@jc/connectors';
import { enfileirarImportacaoAvulsa } from '@jc/jobs';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';

const BUCKET = 'importacoes';

export type RespostaEnvio =
  | { ok: true; importacaoId: string; colunas: string[]; previa: string[][]; totalLinhas: number; sugestao: Mapeamento }
  | { ok: false; erro: string };

const CAMINHO = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(csv|xlsx)$/;

async function organizacaoDaEmpresa(empresaId: string) {
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('empresa').select('organizacao_id').eq('id', empresaId).maybeSingle();
  return { supabase, orgId: (data as { organizacao_id: string } | null)?.organizacao_id };
}

/**
 * Passo 1: devolve uma URL assinada para o navegador enviar o arquivo direto ao Storage.
 * (As funções da Vercel limitam o corpo da requisição a 4,5 MB; a planilha pode ter 10 MB.)
 * O caminho é sempre gerado aqui: <organizacao>/<uuid>.<ext>; o nome do usuário nunca vira caminho.
 */
export async function prepararEnvio(empresaId: string, extensao: string, tamanho: number): Promise<{ ok: true; caminho: string; token: string } | { ok: false; erro: string }> {
  const id = z.string().uuid().safeParse(empresaId);
  const ext = z.enum(['csv', 'xlsx']).safeParse(extensao.toLowerCase());
  if (!id.success) return { ok: false, erro: 'Empresa inválida.' };
  if (!ext.success) return { ok: false, erro: 'Formato não suportado. Envie .csv ou .xlsx.' };
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, erro: 'Selecione um arquivo .csv ou .xlsx.' };
  if (tamanho > LIMITES.bytes) return { ok: false, erro: 'O arquivo excede 10 MB.' };
  const { supabase, orgId } = await organizacaoDaEmpresa(id.data);
  if (!orgId) return { ok: false, erro: 'Empresa não encontrada ou sem permissão.' };
  const caminho = `${orgId}/${randomUUID()}.${ext.data}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (error || !data) return { ok: false, erro: 'Você não tem permissão para enviar arquivos desta empresa.' };
  return { ok: true, caminho, token: data.token };
}

/** Passo 2: depois do envio, lê o arquivo, registra a importação e devolve a prévia e a sugestão de mapeamento. */
export async function analisarArquivo(empresaId: string, caminho: string): Promise<RespostaEnvio> {
  const id = z.string().uuid().safeParse(empresaId);
  const m = CAMINHO.exec(caminho);
  if (!id.success || !m) return { ok: false, erro: 'Requisição inválida.' };
  const { supabase, orgId } = await organizacaoDaEmpresa(id.data);
  if (!orgId || m[1] !== orgId) return { ok: false, erro: 'Empresa não encontrada ou sem permissão.' };

  const descartar = () => supabase.storage.from(BUCKET).remove([caminho]);
  const baixado = await supabase.storage.from(BUCKET).download(caminho);
  if (baixado.error || !baixado.data) return { ok: false, erro: 'Arquivo não encontrado. Tente enviar novamente.' };
  if (baixado.data.size > LIMITES.bytes) { await descartar(); return { ok: false, erro: 'O arquivo excede 10 MB.' }; }
  let planilha;
  try {
    planilha = await lerPlanilha(new Uint8Array(await baixado.data.arrayBuffer()), caminho);
  } catch (e) {
    await descartar();
    return { ok: false, erro: e instanceof ErroPlanilha ? e.message : 'Não foi possível ler o arquivo.' };
  }
  const { data, error } = await supabase.from('importacao')
    .insert({ empresa_id: id.data, tipo: 'colaboradores', arquivo_path: caminho, status: 'aguardando_mapeamento' }).select('id').single();
  if (error || !data) {
    await descartar();
    return { ok: false, erro: 'Você não tem permissão para importar colaboradores nesta empresa.' };
  }
  return {
    ok: true, importacaoId: (data as { id: string }).id, colunas: planilha.colunas, totalLinhas: planilha.linhas.length,
    previa: planilha.linhas.slice(0, 5).map((l) => planilha.colunas.map((c) => l[c] ?? '')), sugestao: sugerirMapeamento(planilha.colunas),
  };
}

const chaves = CAMPOS_COLABORADOR.map((c) => c.chave) as [string, ...string[]];
const mapeamentoSchema = z.record(z.enum(chaves), z.string().nullable());

async function carregar(importacaoId: string, mapeamentoBruto: unknown) {
  const id = z.string().uuid().safeParse(importacaoId);
  const map = mapeamentoSchema.safeParse(mapeamentoBruto);
  if (!id.success || !map.success) return { ok: false, erro: 'Dados inválidos.' } as const;
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('importacao').select('id, empresa_id, arquivo_path, status').eq('id', id.data).maybeSingle();
  const imp = data as { id: string; empresa_id: string; arquivo_path: string; status: string } | null;
  if (!imp) return { ok: false, erro: 'Importação não encontrada.' } as const;
  if (imp.status !== 'aguardando_mapeamento') return { ok: false, erro: 'Esta importação já foi enviada para processamento.' } as const;
  const baixado = await supabase.storage.from(BUCKET).download(imp.arquivo_path);
  if (baixado.error || !baixado.data) return { ok: false, erro: 'Arquivo não encontrado no armazenamento.' } as const;
  const planilha = await lerPlanilha(new Uint8Array(await baixado.data.arrayBuffer()), imp.arquivo_path);
  const mapeamento: Mapeamento = {};
  for (const [campo, coluna] of Object.entries(map.data)) {
    if (coluna && !planilha.colunas.includes(coluna)) return { ok: false, erro: `A coluna "${coluna}" não existe na planilha.` } as const;
    mapeamento[campo as keyof Mapeamento] = coluna || null;
  }
  return { ok: true, supabase, imp, planilha, mapeamento } as const;
}

export type RespostaValidacao =
  | { ok: true; validas: number; ignoradas: number; errosTotal: number; erros: ErroLinha[]; avisosTotal: number; faltando: string[] }
  | { ok: false; erro: string };

/** Validação prévia (dry-run): nada é gravado. */
export async function validarImportacao(importacaoId: string, mapeamento: unknown): Promise<RespostaValidacao> {
  const c = await carregar(importacaoId, mapeamento);
  if (!c.ok) return { ok: false, erro: c.erro };
  const faltando = camposObrigatoriosSemColuna(c.mapeamento).map((k) => CAMPOS_COLABORADOR.find((d) => d.chave === k)!.rotulo);
  const v = validarColaboradores(c.planilha.linhas, c.mapeamento);
  return {
    ok: true, validas: v.validas.length, ignoradas: v.ignoradas, errosTotal: v.erros.length, erros: v.erros.slice(0, 100),
    avisosTotal: v.validas.reduce((a, x) => a + x.avisos.length, 0), faltando,
  };
}

/** Confirma: grava o mapeamento, marca como processando e enfileira o job. */
export async function confirmarImportacao(importacaoId: string, mapeamento: unknown): Promise<{ erro: string } | never> {
  const c = await carregar(importacaoId, mapeamento);
  if (!c.ok) return { erro: c.erro };
  if (camposObrigatoriosSemColuna(c.mapeamento).length > 0) return { erro: 'Mapeie todas as colunas obrigatórias.' };
  const url = process.env.DATABASE_URL;
  if (!url) return { erro: 'Fila de processamento não configurada (DATABASE_URL).' };

  const { data, error } = await c.supabase.from('importacao').update({ mapeamento: c.mapeamento, status: 'processando' })
    .eq('id', c.imp.id).eq('status', 'aguardando_mapeamento').select('id');
  if (error || !data || data.length === 0) return { erro: 'Não foi possível iniciar o processamento.' };
  try {
    await enfileirarImportacaoAvulsa(url, c.imp.id);
  } catch {
    await c.supabase.from('importacao').update({ status: 'aguardando_mapeamento' }).eq('id', c.imp.id);
    return { erro: 'Falha ao enfileirar o processamento. Tente novamente.' };
  }
  redirect(`/empresas/${c.imp.empresa_id}/importar/${c.imp.id}`);
}
