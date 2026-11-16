'use server';

import { carregarEntradaEscala, ErroServico, publicarEscala } from '@jc/servicos';
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

export async function criarModelo(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const empresaId = id.safeParse(form.get('empresaId'));
  const nome = z.string().trim().min(1, 'Dê um nome ao turno.').max(40).safeParse(form.get('nome'));
  const ini = hora.safeParse(form.get('inicio')), fim = hora.safeParse(form.get('fim'));
  const intervalo = z.coerce.number().int().min(0).max(240).safeParse(form.get('intervalo') || 0);
  if (!empresaId.success || !nome.success || !ini.success || !fim.success || !intervalo.success) return { erro: 'Confira o nome, os horários e o intervalo.' };
  let i = minutos(ini.data), f = minutos(fim.data);
  if (f <= i) f += 1440; // termina no dia seguinte (turno noturno)
  if (f - i > 1440) return { erro: 'O turno não pode passar de 24 horas.' };
  if (intervalo.data >= f - i) return { erro: 'O intervalo precisa ser menor que o turno.' };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.from('turno_modelo').insert({ empresa_id: empresaId.data, nome: nome.data, inicio_min: i, fim_min: f, intervalo_min: intervalo.data });
  if (error) return { erro: /duplicate|unique/i.test(error.message) ? 'Já existe um turno com esse nome.' : 'Não foi possível salvar o turno.' };
  revalidatePath(`/empresas/${empresaId.data}/escalas`);
  return {};
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
    if (e.escala.status !== 'publicada') return { ok: false, erro: 'Só uma escala publicada pode ganhar nova versão.' };
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
