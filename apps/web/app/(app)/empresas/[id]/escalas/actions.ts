'use server';

import { enfileirarOtimizacaoAvulsa } from '@jc/jobs';
import { carregarEntradaEscala, ErroServico, publicarEscala, validarEntrada } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';
import { paraGravacao, type Celula } from '@/lib/escala-editor';
import { supabaseServidorRestrito } from '@/lib/supabase/servidor-restrito';

export type EstadoForm = { erro?: string };
const id = z.string().uuid();
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.');
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Mensagens do banco são em português e feitas para o usuário; erros inesperados viram texto genérico. */
const traduzir = (e: unknown, padrao: string): string => {
  if (e instanceof ErroServico) return /permission denied|sem permiss|row-level security/i.test(e.message) ? 'Você não tem permissão para esta ação.' : e.message;
  return padrao;
};

export async function criarEscala(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const empresaId = id.safeParse(form.get('empresaId'));
  const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(form.get('mes'));
  const nome = z.string().trim().min(2, 'Dê um nome à escala.').max(80).safeParse(form.get('nome'));
  const setorRaw = String(form.get('setorId') ?? '');
  const setor = setorRaw ? id.safeParse(setorRaw) : { success: true as const, data: null };
  if (!empresaId.success || !mes.success || !nome.success || !setor.success) return { erro: nome.success ? 'Informe o mês da escala.' : 'Dê um nome à escala.' };
  const { supabase, user } = await exigirUsuario();
  const [ano, m] = mes.data.split('-').map(Number) as [number, number];
  const inicio = `${mes.data}-01`;
  const proximo = m === 12 ? `${ano + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, '0')}-01`;
  const { data, error } = await supabase.from('escala').insert({
    empresa_id: empresaId.data, setor_id: setor.data, nome: nome.data, periodo: `[${inicio},${proximo})`, criado_por: user.id,
  }).select('id').single();
  if (error || !data) return { erro: /row-level|permission/i.test(error?.message ?? '') ? 'Você não tem permissão para criar escalas nesta empresa.' : 'Não foi possível criar a escala.' };
  redirect(`/empresas/${empresaId.data}/escalas/${(data as { id: string }).id}`);
}

/** Lê e confere os campos de um turno (criação e edição usam as mesmas regras). */
function lerDadosTurno(form: FormData): { erro: string } | { nome: string; inicio: number; fim: number; intervalo: number } {
  const nome = z.string().trim().min(1, 'Dê um nome ao turno.').max(40).safeParse(form.get('nome'));
  const ini = hora.safeParse(form.get('inicio')), fim = hora.safeParse(form.get('fim'));
  const intervalo = z.coerce.number().int().min(0).max(240).safeParse(form.get('intervalo') || 0);
  if (!nome.success || !ini.success || !fim.success || !intervalo.success) return { erro: 'Confira o nome, os horários e o intervalo.' };
  const i = minutos(ini.data);
  let f = minutos(fim.data);
  if (f <= i) f += 1440; // termina no dia seguinte (turno noturno)
  if (f - i > 1440) return { erro: 'O turno não pode passar de 24 horas.' };
  if (intervalo.data >= f - i) return { erro: 'O intervalo precisa ser menor que o turno.' };
  return { nome: nome.data, inicio: i, fim: f, intervalo: intervalo.data };
}
const erroTurno = (m: string) => (/duplicate|unique/i.test(m) ? 'Já existe um turno com esse nome.' : /row-level|permission/i.test(m) ? 'Você não tem permissão para alterar os turnos desta empresa.' : 'Não foi possível salvar o turno.');

export async function criarModelo(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const empresaId = id.safeParse(form.get('empresaId'));
  const d = lerDadosTurno(form);
  if (!empresaId.success) return { erro: 'Pedido inválido.' };
  if ('erro' in d) return d;
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.from('turno_modelo').insert({ empresa_id: empresaId.data, nome: d.nome, inicio_min: d.inicio, fim_min: d.fim, intervalo_min: d.intervalo });
  if (error) return { erro: erroTurno(error.message) };
  revalidatePath(`/empresas/${empresaId.data}/escalas`);
  revalidatePath(`/empresas/${empresaId.data}/escalas/turnos`);
  return {};
}

/**
 * Edita um turno cadastrado. Vale daqui para frente: escalas já montadas guardam os próprios horários em cada
 * alocação (e as publicadas são imutáveis), então nada do que já foi escalado muda. O banco registra a alteração na auditoria.
 */
export async function editarModelo(_: EstadoForm & { ok?: boolean }, form: FormData): Promise<EstadoForm & { ok?: boolean }> {
  const empresaId = id.safeParse(form.get('empresaId')), modeloId = id.safeParse(form.get('modeloId'));
  const d = lerDadosTurno(form);
  if (!empresaId.success || !modeloId.success) return { erro: 'Pedido inválido.' };
  if ('erro' in d) return d;
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.from('turno_modelo').update({ nome: d.nome, inicio_min: d.inicio, fim_min: d.fim, intervalo_min: d.intervalo })
    .eq('id', modeloId.data).eq('empresa_id', empresaId.data).select('id');
  if (error) return { erro: erroTurno(error.message) };
  if (!Array.isArray(data) || data.length === 0) return { erro: 'Turno não encontrado ou sem permissão para alterá-lo.' };
  revalidatePath(`/empresas/${empresaId.data}/escalas`);
  revalidatePath(`/empresas/${empresaId.data}/escalas/turnos`);
  return { ok: true };
}

/** Tira o turno da lista (arquiva). Não apaga: escalas que o usaram continuam ligadas a ele. */
export async function arquivarModelo(empresaId: string, modeloId: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const e = id.safeParse(empresaId), m = id.safeParse(modeloId);
  if (!e.success || !m.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.from('turno_modelo').update({ ativo: false }).eq('id', m.data).eq('empresa_id', e.data).select('id');
  if (error) return { ok: false, erro: erroTurno(error.message) };
  if (!Array.isArray(data) || data.length === 0) return { ok: false, erro: 'Turno não encontrado ou sem permissão para removê-lo.' };
  revalidatePath(`/empresas/${e.data}/escalas`);
  revalidatePath(`/empresas/${e.data}/escalas/turnos`);
  return { ok: true };
}

export type ResultadoGravacao = { ok: true; revisao: number } | { ok: false; erro: string };

export async function salvarGrade(escalaId: string, revisao: number, alocacoes: Celula[]): Promise<ResultadoGravacao> {
  const eid = id.safeParse(escalaId);
  if (!eid.success || !Number.isInteger(revisao) || !Array.isArray(alocacoes)) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.rpc('salvar_alocacoes', { p_escala: eid.data, p_revisao: revisao, p_alocacoes: paraGravacao(alocacoes) });
  if (error) return { ok: false, erro: /exclusion|sobrep/i.test(error.message) ? 'Há turnos sobrepostos para a mesma pessoa.' : /permission|row-level/i.test(error.message) ? 'Você não tem permissão para alterar esta escala.' : error.message };
  return { ok: true, revisao: Number(data) };
}

export type ResultadoPublicacao = { ok: true; hash: string } | { ok: false; erro: string };

export async function publicar(escalaId: string): Promise<ResultadoPublicacao> {
  const eid = id.safeParse(escalaId);
  if (!eid.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase, user } = await exigirUsuario();
  const servidor = supabaseServidorRestrito();
  if (!servidor) return { ok: false, erro: 'A publicação ainda não está habilitada neste ambiente: falta configurar a chave de serviço (SUPABASE_SERVICE_ROLE_KEY) no servidor web.' };
  try {
    const r = await publicarEscala(supabase, servidor, eid.data, user.id);
    revalidatePath('/empresas');
    return { ok: true, hash: r.hash };
  } catch (e) {
    return { ok: false, erro: traduzir(e, 'Não foi possível publicar a escala.') };
  }
}

/** Copia uma escala publicada para um novo rascunho do mesmo período (única forma de alterar o que foi publicado). */
export async function novaVersao(escalaId: string): Promise<{ ok: true; escalaId: string } | { ok: false; erro: string }> {
  const eid = id.safeParse(escalaId);
  if (!eid.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase, user } = await exigirUsuario();
  try {
    const e = await carregarEntradaEscala(supabase, eid.data);
    if (e.escala.status === 'rascunho') return { ok: false, erro: 'Só uma escala publicada (ou uma versão antiga) pode ganhar nova versão.' };
    const fimExclusivo = new Date(Date.parse(`${e.escala.fim}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await supabase.from('escala').insert({
      empresa_id: e.escala.empresaId, setor_id: e.escala.setorId, nome: e.escala.nome, periodo: `[${e.escala.inicio},${fimExclusivo})`, criado_por: user.id,
    }).select('id').single();
    if (error || !data) return { ok: false, erro: 'Não foi possível criar a nova versão.' };
    const novo = (data as { id: string }).id;
    const { error: e2 } = await supabase.rpc('salvar_alocacoes', { p_escala: novo, p_revisao: 1, p_alocacoes: paraGravacao(e.alocacoes) });
    if (e2) return { ok: false, erro: 'A nova versão foi criada, mas não foi possível copiar as alocações.' };
    return { ok: true, escalaId: novo };
  } catch (err) {
    return { ok: false, erro: traduzir(err, 'Não foi possível criar a nova versão.') };
  }
}

// ===== Geração automática de propostas (otimizador) =====
export type ResumoProposta = {
  indice: number; status: 'otima' | 'viavel'; alertas: number; infos: number;
  metricas: { faltaCobertura: number; faltaIdeal: number; deficitHorasMin: number; domingosMin: number; domingosMax: number; preferenciasNaoAtendidas: number; custoReais: number; mudancasEmRelacaoReferencia: number; objetivo: number };
};
export type EstadoOtimizacao = {
  id: string; status: 'pendente' | 'processando' | 'concluida' | 'erro'; erro: string | null;
  resumo: null | { status: 'otima' | 'viavel' | 'inviavel'; mensagem: string | null; tempoMs: number; descartadas: number; propostas: ResumoProposta[] };
};

export async function gerarPropostasAutomaticas(escalaId: string, numSolucoes: 1 | 2 | 3 = 3, tempoLimiteS = 30): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const eid = id.safeParse(escalaId);
  if (!eid.success) return { ok: false, erro: 'Pedido inválido.' };
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, erro: 'A fila de processamento não está configurada neste ambiente (DATABASE_URL).' };
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.rpc('solicitar_otimizacao', { p_escala: eid.data, p_opcoes: { numSolucoes, tempoLimiteS } });
  if (error || typeof data !== 'string') {
    return { ok: false, erro: /permission|sem permiss|row-level/i.test(error?.message ?? '') ? 'Você não tem permissão para gerar propostas nesta escala.' : (error?.message ?? 'Não foi possível pedir as propostas.') };
  }
  try {
    await enfileirarOtimizacaoAvulsa(url, data);
  } catch {
    await supabase.rpc('cancelar_otimizacao', { p_id: data }); // libera a escala para um novo pedido
    return { ok: false, erro: 'O pedido foi registrado, mas não foi possível colocá-lo na fila. Tente de novo em instantes.' };
  }
  return { ok: true, id: data };
}

export async function cancelarOtimizacao(otimizacaoId: string): Promise<{ ok: boolean }> {
  const oid = id.safeParse(otimizacaoId);
  if (!oid.success) return { ok: false };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('cancelar_otimizacao', { p_id: oid.data });
  return { ok: !error };
}

export async function lerOtimizacao(otimizacaoId: string): Promise<EstadoOtimizacao | null> {
  const oid = id.safeParse(otimizacaoId);
  if (!oid.success) return null;
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('otimizacao').select('id, status, erro, resumo').eq('id', oid.data).maybeSingle();
  return (data as EstadoOtimizacao | null) ?? null;
}

const propostaZ = z.object({
  indice: z.number().int(),
  alocacoes: z.array(z.object({
    colaboradorId: z.string(), data: z.string(), tipo: z.enum(['trabalho', 'folga', 'dsr', 'ferias', 'afastamento', 'feriado']),
    inicioMin: z.number().optional(), fimMin: z.number().optional(), intervaloMin: z.number().optional(), modeloId: z.string().nullable().optional(),
  })),
});

/** Aplica uma proposta à grade (rascunho). Revalida contra o estado ATUAL da escala: se algo mudou e há bloqueio, recusa. */
export async function aplicarProposta(otimizacaoId: string, indice: number): Promise<{ ok: true } | { ok: false; erro: string }> {
  const oid = id.safeParse(otimizacaoId);
  if (!oid.success || !Number.isInteger(indice)) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('otimizacao').select('escala_id, status, resultado').eq('id', oid.data).maybeSingle();
  const o = data as { escala_id: string; status: string; resultado: { propostas?: unknown[] } | null } | null;
  if (!o || o.status !== 'concluida') return { ok: false, erro: 'Esta geração de propostas não está disponível.' };
  const proposta = (o.resultado?.propostas ?? []).map((p) => propostaZ.safeParse(p)).find((p) => p.success && p.data.indice === indice);
  if (!proposta?.success) return { ok: false, erro: 'Proposta não encontrada.' };
  try {
    const entrada = await carregarEntradaEscala(supabase, o.escala_id);
    if (entrada.escala.status !== 'rascunho') return { ok: false, erro: 'A escala já foi publicada; crie uma nova versão para alterá-la.' };
    const validacao = validarEntrada(entrada, proposta.data.alocacoes);
    if (validacao.bloqueios > 0) return { ok: false, erro: 'A escala mudou desde que a proposta foi gerada (por exemplo, férias lançadas) e ela já não é válida. Gere as propostas de novo.' };
    const { error } = await supabase.rpc('salvar_alocacoes', { p_escala: o.escala_id, p_revisao: entrada.escala.revisao, p_alocacoes: paraGravacao(proposta.data.alocacoes as Celula[]) });
    if (error) return { ok: false, erro: /alterada por outra pessoa/.test(error.message) ? 'A escala foi alterada por outra pessoa. Recarregue a página e aplique de novo.' : 'Não foi possível aplicar a proposta.' };
    revalidatePath(`/empresas`);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: traduzir(e, 'Não foi possível aplicar a proposta.') };
  }
}
