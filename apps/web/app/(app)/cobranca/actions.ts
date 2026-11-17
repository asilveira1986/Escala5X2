'use server';

import { ErroCobranca, type FormaPagamento } from '@jc/servicos';
import { dataDeInstante, somarDias } from '@jc/rules-engine';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { provedorDeCobranca } from '@/lib/cobranca';
import { exigirUsuario } from '@/lib/contexto';
import { supabaseServidorRestrito } from '@/lib/supabase/servidor-restrito';

export type ResultadoCobranca = { ok: true; mensagem: string } | { ok: false; erro: string };
const uuid = z.string().uuid();
const formaZ = z.enum(['pix', 'boleto', 'cartao', 'indefinida']);
const NAO_CONFIGURADO = 'A cobrança ainda não está configurada neste ambiente (faltam as chaves do provedor de pagamento no servidor).';

type Assin = { id: string; status: string; plano_id: string | null; teste_ate: string | null; cliente_externo: string | null; assinatura_externa: string | null };

/** Só o administrador da organização mexe na assinatura. Devolve as peças que as ações precisam. */
async function contexto(orgId: string) {
  const { supabase, user } = await exigirUsuario();
  const { data: m } = await supabase.from('membro').select('papel').eq('organizacao_id', orgId).eq('usuario_id', user.id).maybeSingle();
  if ((m as { papel?: string } | null)?.papel !== 'admin') return { erro: 'Só o administrador da organização pode alterar o plano e a cobrança.' } as const;
  const { data: a } = await supabase.from('assinatura').select('id, status, plano_id, teste_ate, cliente_externo, assinatura_externa').eq('organizacao_id', orgId).maybeSingle();
  if (!a) return { erro: 'Esta organização ainda não tem assinatura.' } as const;
  return { erro: undefined, supabase, user, assinatura: a as Assin };
}
const traduzir = (e: unknown): string => (e instanceof ErroCobranca ? e.message : 'Não foi possível concluir agora. Tente de novo em instantes.');

/** Escolhe um plano e cria a assinatura no provedor. A primeira cobrança vence quando o teste acaba (ou amanhã). */
export async function assinar(orgId: string, planoId: string, forma: FormaPagamento): Promise<ResultadoCobranca> {
  const p = z.object({ orgId: uuid, planoId: uuid, forma: formaZ }).safeParse({ orgId, planoId, forma });
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  const provedor = provedorDeCobranca(), servidor = supabaseServidorRestrito();
  if (!provedor || !servidor) return { ok: false, erro: NAO_CONFIGURADO };
  const c = await contexto(p.data.orgId);
  if (c.erro) return { ok: false, erro: c.erro };
  if (c.assinatura.assinatura_externa && ['ativa', 'aguardando_pagamento', 'inadimplente'].includes(c.assinatura.status)) return { ok: false, erro: 'Já existe uma assinatura em andamento: use "Trocar de plano".' };
  const [{ data: plano }, { data: org }] = await Promise.all([
    c.supabase.from('plano').select('id, nome, preco_centavos').eq('id', p.data.planoId).maybeSingle(),
    c.supabase.from('organizacao').select('id, nome, cnpj').eq('id', p.data.orgId).maybeSingle(),
  ]);
  const pl = plano as { id: string; nome: string; preco_centavos: number } | null, o = org as { id: string; nome: string; cnpj: string | null } | null;
  if (!pl || !o) return { ok: false, erro: 'Plano ou organização não encontrados.' };
  try {
    const clienteId = c.assinatura.cliente_externo ?? (await provedor.criarCliente({ nome: o.nome, cnpj: o.cnpj, email: c.user.email ?? null, referencia: o.id })).id;
    const hoje = dataDeInstante(new Date()), amanha = somarDias(hoje, 1);
    const vencimento = c.assinatura.status === 'teste' && c.assinatura.teste_ate && c.assinatura.teste_ate > amanha ? c.assinatura.teste_ate : amanha;
    const sub = await provedor.criarAssinatura({ clienteExterno: clienteId, valorCentavos: pl.preco_centavos, forma: p.data.forma, primeiroVencimento: vencimento, descricao: `JornadaCerta — plano ${pl.nome}`, referencia: c.assinatura.id });
    const { error } = await servidor.rpc('definir_assinatura', { p_org: o.id, p_plano: pl.id, p_provedor: provedor.nome, p_cliente: clienteId, p_assinatura: sub.id, p_forma: p.data.forma, p_vencimento: vencimento });
    if (error) return { ok: false, erro: 'A assinatura foi criada no provedor, mas não foi possível registrá-la aqui. Fale com o suporte antes de tentar de novo.' };
    revalidatePath('/cobranca');
    return { ok: true, mensagem: `Assinatura criada. A primeira fatura vence em ${vencimento.split('-').reverse().join('/')} e aparece abaixo em instantes.` };
  } catch (e) { return { ok: false, erro: traduzir(e) }; }
}

/** Troca o plano: o valor das próximas cobranças muda no provedor e o plano muda aqui. */
export async function trocarPlano(orgId: string, planoId: string): Promise<ResultadoCobranca> {
  const p = z.object({ orgId: uuid, planoId: uuid }).safeParse({ orgId, planoId });
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  const servidor = supabaseServidorRestrito();
  if (!servidor) return { ok: false, erro: NAO_CONFIGURADO };
  const c = await contexto(p.data.orgId);
  if (c.erro) return { ok: false, erro: c.erro };
  const { data: plano } = await c.supabase.from('plano').select('id, preco_centavos').eq('id', p.data.planoId).maybeSingle();
  const pl = plano as { id: string; preco_centavos: number } | null;
  if (!pl) return { ok: false, erro: 'Plano não encontrado.' };
  try {
    if (c.assinatura.assinatura_externa) {
      const provedor = provedorDeCobranca();
      if (!provedor) return { ok: false, erro: NAO_CONFIGURADO };
      await provedor.atualizarValor(c.assinatura.assinatura_externa, pl.preco_centavos);
    }
    const { error } = await servidor.rpc('trocar_plano_assinatura', { p_org: p.data.orgId, p_plano: pl.id });
    if (error) return { ok: false, erro: 'Não foi possível registrar a troca de plano.' };
    revalidatePath('/cobranca');
    return { ok: true, mensagem: 'Plano alterado. O novo valor vale a partir da próxima fatura.' };
  } catch (e) { return { ok: false, erro: traduzir(e) }; }
}

export async function cancelarAssinatura(orgId: string): Promise<ResultadoCobranca> {
  const p = uuid.safeParse(orgId);
  if (!p.success) return { ok: false, erro: 'Pedido inválido.' };
  const servidor = supabaseServidorRestrito();
  if (!servidor) return { ok: false, erro: NAO_CONFIGURADO };
  const c = await contexto(p.data);
  if (c.erro) return { ok: false, erro: c.erro };
  try {
    if (c.assinatura.assinatura_externa) {
      const provedor = provedorDeCobranca();
      if (!provedor) return { ok: false, erro: NAO_CONFIGURADO };
      await provedor.cancelarAssinatura(c.assinatura.assinatura_externa);
    }
    const { error } = await servidor.rpc('cancelar_assinatura_cobranca', { p_org: p.data });
    if (error) return { ok: false, erro: 'Não foi possível registrar o cancelamento.' };
    revalidatePath('/cobranca');
    return { ok: true, mensagem: 'Assinatura cancelada. Você pode escolher um plano de novo quando quiser.' };
  } catch (e) { return { ok: false, erro: traduzir(e) }; }
}
