'use server';

import { CAMPOS_COLABORADOR, validarColaboradores, type CampoColaborador, type Mapeamento } from '@jc/connectors';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formatarCbo, type OcupacaoCbo } from '@/lib/cbo';
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
