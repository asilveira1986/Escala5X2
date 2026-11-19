'use server';

import { CAMPOS_COLABORADOR, parseEscolaridade, parseTelefone, validarColaboradores, type CampoColaborador, type Mapeamento } from '@jc/connectors';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formatarCbo, type OcupacaoCbo } from '@/lib/cbo';
import { validarContrato } from '@/lib/colaborador-form';
import { exigirUsuario } from '@/lib/contexto';
import { enviarLinkDeAcesso } from '@/lib/supabase/envio-link';

export type ResultadoAcesso = { ok: true; mensagem: string } | { ok: false; erro: string };
const ids = z.object({ empresaId: z.string().uuid(), colaboradorId: z.string().uuid() });
const traduzir = (m: string) => (/sem permiss/i.test(m) ? 'Você não tem permissão para esta ação.' : m);

export async function convidar(empresaId: string, colaboradorId: string, email: string): Promise<ResultadoAcesso> {
  const p = ids.safeParse({ empresaId, colaboradorId });
  const e = z.string().trim().email('Informe um e-mail válido.').safeParse(email);
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  if (!e.success) return { ok: false, erro: 'Informe um e-mail válido.' };
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.rpc('convidar_colaborador', { p_colaborador: p.data.colaboradorId, p_email: e.data });
  if (error) return { ok: false, erro: traduzir(error.message) };
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores`);
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores/${p.data.colaboradorId}`);
  const estado = (data as { estado?: string } | null)?.estado;
  if (estado === 'vinculado') return { ok: true, mensagem: 'Esse e-mail já tinha conta. O acesso foi liberado: basta a pessoa entrar para ver a escala.' };
  const envio = await enviarLinkDeAcesso(e.data.toLowerCase());
  return envio.ok
    ? { ok: true, mensagem: `Convite enviado para ${e.data.toLowerCase()}. O vínculo é feito quando a pessoa abrir o link.` }
    : { ok: true, mensagem: 'Convite registrado, mas o e-mail não pôde ser enviado agora (o limite de envios do Supabase pode ter sido atingido). Tente reenviar em alguns minutos.' };
}

export async function revogarAcesso(empresaId: string, colaboradorId: string): Promise<ResultadoAcesso> {
  const p = ids.safeParse({ empresaId, colaboradorId });
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('revogar_acesso_colaborador', { p_colaborador: p.data.colaboradorId });
  if (error) return { ok: false, erro: traduzir(error.message) };
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores`);
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores/${p.data.colaboradorId}`);
  return { ok: true, mensagem: 'Acesso removido.' };
}

export type EstadoNovoColaborador = { erros?: Partial<Record<CampoColaborador, string>>; erroGeral?: string; valores?: Record<string, string> };
const CHAVES = CAMPOS_COLABORADOR.map((c) => c.chave).filter((c) => c !== 'desligamento');

/** Cadastro manual: valida com as mesmas regras da importação por planilha e grava pessoa + contrato de uma vez. */
export async function cadastrarColaborador(empresaId: string, _: EstadoNovoColaborador, form: FormData): Promise<EstadoNovoColaborador> {
  const id = z.string().uuid().safeParse(empresaId);
  if (!id.success) return { erroGeral: 'Empresa inválida.' };
  const valores = Object.fromEntries(CHAVES.map((c) => [c, String(form.get(c) ?? '').trim()]));
  const mapeamento: Mapeamento = Object.fromEntries(CHAVES.map((c) => [c, c]));
  const cbo = valores.cbo ? formatarCbo(valores.cbo) : '';
  const lista = valores.cbo ? ((await import('@/lib/cbo-dados.json')).default as unknown as OcupacaoCbo[]) : [];
  const cboInvalido = valores.cbo && (!cbo || !lista.some(([c]) => c === cbo));
  const { validas, erros } = validarColaboradores([{ ...valores, cbo: cbo || '' }], mapeamento);
  if (cboInvalido) erros.push({ linha: 2, campo: 'cbo', valor: valores.cbo!, mensagem: 'Escolha uma ocupação da lista.' });
  if (erros.length > 0 || !validas[0]) {
    return { valores, erros: Object.fromEntries(erros.filter((e) => e.campo !== 'geral').map((e) => [e.campo, e.mensagem])) as EstadoNovoColaborador['erros'], erroGeral: erros.find((e) => e.campo === 'geral')?.mensagem };
  }
  const c = validas[0];
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('cadastrar_colaborador', {
    p_empresa: id.data, p_nome: c.nome, p_cpf: c.cpf, p_admissao: c.admissao, p_salario: c.salarioCentavos / 100, p_jornada_min: c.jornadaSemanalMin,
    p_divisor: c.divisor, p_tipo_escala: c.tipoEscala, p_setor_nome: c.setor, p_matricula: c.matricula, p_cargo: c.cargo, p_cbo: c.cbo,
    p_escolaridade: c.escolaridade, p_telefone: c.telefone, p_turno: c.turno, p_folgas: c.folgasSemana, p_horas_extras_min: c.horasExtrasMensaisMin,
  });
  if (error) {
    if (/CPF já cadastrado/i.test(error.message)) return { valores, erros: { cpf: 'Já existe um colaborador com este CPF nesta empresa.' } };
    return { valores, erroGeral: traduzir(error.message).slice(0, 200) || 'Não foi possível cadastrar o colaborador.' };
  }
  revalidatePath(`/empresas/${id.data}/colaboradores`);
  redirect(`/empresas/${id.data}/colaboradores`);
}

// ===== Edição, mudança de contrato, desligamento e reativação =====
const DATA_ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data válida.').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Informe uma data válida.');
const ids2 = z.object({ empresaId: z.string().uuid(), colaboradorId: z.string().uuid() });
export type EstadoEdicao = { erros?: Record<string, string>; erroGeral?: string; ok?: string; valores?: Record<string, string> };
const lerForm = (form: FormData, chaves: string[]) => Object.fromEntries(chaves.map((c) => [c, String(form.get(c) ?? '').trim()]));

async function cboValido(bruto: string): Promise<{ ok: true; cbo: string | null } | { ok: false }> {
  if (!bruto) return { ok: true, cbo: null };
  const f = formatarCbo(bruto);
  const lista = (await import('@/lib/cbo-dados.json')).default as unknown as OcupacaoCbo[];
  return f && lista.some(([c]) => c === f) ? { ok: true, cbo: f.replace('-', '') } : { ok: false };
}

export async function atualizarDadosColaborador(empresaId: string, colaboradorId: string, _: EstadoEdicao, form: FormData): Promise<EstadoEdicao> {
  const p = ids2.safeParse({ empresaId, colaboradorId });
  if (!p.success) return { erroGeral: 'Pedido inválido.' };
  const v = lerForm(form, ['nome', 'setor', 'matricula', 'cargo', 'cbo', 'escolaridade', 'telefone']);
  const erros: Record<string, string> = {};
  if (v.nome!.length < 2) erros.nome = 'Nome obrigatório.';
  const cbo = await cboValido(v.cbo!);
  if (!cbo.ok) erros.cbo = 'Escolha uma ocupação da lista.';
  const tel = v.telefone ? parseTelefone(v.telefone) : null;
  if (v.telefone && !tel) erros.telefone = 'Telefone inválido: use DDD e número.';
  const esc = v.escolaridade ? parseEscolaridade(v.escolaridade) : null;
  if (v.escolaridade && !esc) erros.escolaridade = 'Escolaridade inválida.';
  if (Object.keys(erros).length > 0) return { erros, valores: v };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('atualizar_colaborador', {
    p_colaborador: p.data.colaboradorId, p_nome: v.nome, p_setor_nome: v.setor || null, p_matricula: v.matricula || null, p_cargo: v.cargo || null,
    p_cbo: cbo.ok ? cbo.cbo : null, p_escolaridade: esc, p_telefone: tel,
  });
  if (error) return { valores: v, erroGeral: traduzir(error.message).slice(0, 200) };
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores`);
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores/${p.data.colaboradorId}`);
  return { ok: 'Dados salvos.', valores: v };
}

export async function mudarContrato(empresaId: string, colaboradorId: string, _: EstadoEdicao, form: FormData): Promise<EstadoEdicao> {
  const p = ids2.safeParse({ empresaId, colaboradorId });
  if (!p.success) return { erroGeral: 'Pedido inválido.' };
  const v = lerForm(form, ['a_partir_de', 'salario', 'jornada_semanal', 'tipo_escala', 'turno', 'divisor', 'folgas_semana', 'horas_extras_mensais']);
  const data = DATA_ISO.safeParse(v.a_partir_de);
  const c = validarContrato(v);
  const erros: Record<string, string> = c.ok ? {} : { ...c.erros } as Record<string, string>;
  if (!data.success) erros.a_partir_de = 'Informe a data em que a mudança passa a valer.';
  if (Object.keys(erros).length > 0 || !c.ok || !data.success) return { erros, valores: v };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('alterar_contrato', {
    p_colaborador: p.data.colaboradorId, p_a_partir_de: data.data, p_salario: c.contrato.salarioCentavos / 100, p_jornada_min: c.contrato.jornadaSemanalMin,
    p_divisor: c.contrato.divisor, p_tipo_escala: c.contrato.tipoEscala, p_turno: c.contrato.turno, p_folgas: c.contrato.folgasSemana, p_horas_extras_min: c.contrato.horasExtrasMensaisMin,
  });
  if (error) return { valores: v, erros: /data|admiss|contrato/i.test(error.message) ? { a_partir_de: traduzir(error.message).slice(0, 160) } : undefined, erroGeral: /data|admiss|contrato/i.test(error.message) ? undefined : traduzir(error.message).slice(0, 200) };
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores`);
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores/${p.data.colaboradorId}`);
  return { ok: 'Contrato atualizado. O histórico foi mantido.' };
}

export type ResultadoDesligamento = { ok: true; mensagem: string } | { ok: false; erro: string };

export async function desligarColaborador(empresaId: string, colaboradorId: string, data: string): Promise<ResultadoDesligamento> {
  const p = ids2.safeParse({ empresaId, colaboradorId });
  const d = DATA_ISO.safeParse(data);
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  if (!d.success) return { ok: false, erro: 'Informe o último dia de trabalho.' };
  const { supabase } = await exigirUsuario();
  const { data: r, error } = await supabase.rpc('desligar_colaborador', { p_colaborador: p.data.colaboradorId, p_data: d.data });
  if (error) return { ok: false, erro: traduzir(error.message).slice(0, 200) };
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores`);
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores/${p.data.colaboradorId}`);
  const dias = Number((r as { dias_em_escala?: number } | null)?.dias_em_escala ?? 0);
  return { ok: true, mensagem: dias > 0 ? `Desligamento registrado. Atenção: ainda há ${dias} dia(s) de trabalho em escalas depois dessa data; ajuste as escalas.` : 'Desligamento registrado.' };
}

export async function reativarColaborador(empresaId: string, colaboradorId: string): Promise<ResultadoDesligamento> {
  const p = ids2.safeParse({ empresaId, colaboradorId });
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('reativar_colaborador', { p_colaborador: p.data.colaboradorId });
  if (error) return { ok: false, erro: traduzir(error.message).slice(0, 200) };
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores`);
  revalidatePath(`/empresas/${p.data.empresaId}/colaboradores/${p.data.colaboradorId}`);
  return { ok: true, mensagem: 'Colaborador reativado.' };
}
