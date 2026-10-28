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

export async function enviarPlanilha(_: RespostaEnvio | null, form: FormData): Promise<RespostaEnvio> {
  const empresaId = z.string().uuid().safeParse(form.get('empresaId'));
  const arquivo = form.get('arquivo');
  if (!empresaId.success) return { ok: false, erro: 'Empresa inválida.' };
  if (!(arquivo instanceof File) || arquivo.size === 0) return { ok: false, erro: 'Selecione um arquivo .csv ou .xlsx.' };
  if (arquivo.size > LIMITES.bytes) return { ok: false, erro: 'O arquivo excede 10 MB.' };
  const ext = arquivo.name.toLowerCase().split('.').pop();
  if (ext !== 'csv' && ext !== 'xlsx') return { ok: false, erro: 'Formato não suportado. Envie .csv ou .xlsx.' };

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let planilha;
  try {
    planilha = await lerPlanilha(bytes, arquivo.name);
  } catch (e) {
    return { ok: false, erro: e instanceof ErroPlanilha ? e.message : 'Não foi possível ler o arquivo.' };
  }

  const { supabase } = await exigirUsuario();
  const { data: emp } = await supabase.from('empresa').select('organizacao_id').eq('id', empresaId.data).maybeSingle();
  const orgId = (emp as { organizacao_id: string } | null)?.organizacao_id;
  if (!orgId) return { ok: false, erro: 'Empresa não encontrada ou sem permissão.' };

  // Caminho gerado pelo servidor: <organizacao>/<uuid>.<ext>. O banco valida a pasta; o nome do usuário nunca vira caminho.
  const caminho = `${orgId}/${randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(caminho, bytes, { contentType: ext === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false });
  if (up.error) return { ok: false, erro: 'Falha ao armazenar o arquivo.' };

  const { data, error } = await supabase.from('importacao')
    .insert({ empresa_id: empresaId.data, tipo: 'colaboradores', arquivo_path: caminho, status: 'aguardando_mapeamento' }).select('id').single();
  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([caminho]);
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
