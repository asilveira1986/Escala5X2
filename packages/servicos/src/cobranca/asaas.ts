import { ErroCobranca, type DadosCliente, type EventoCobranca, type FormaPagamento, type PedidoAssinatura, type ProvedorCobranca, type TipoEvento } from './tipos';

/**
 * Provedor Asaas (API v3). ATENÇÃO: escrito a partir da documentação pública, SEM teste contra a API real (o ambiente de
 * desenvolvimento não alcança o Asaas). Valide no sandbox (https://sandbox.asaas.com) antes de cobrar de verdade.
 */
export type ConfigAsaas = { chave: string; ambiente: 'sandbox' | 'producao'; fetch?: typeof fetch };
const URL_BASE = { sandbox: 'https://sandbox.asaas.com/api/v3', producao: 'https://api.asaas.com/v3' } as const;
const TIPO_COBRANCA: Record<FormaPagamento, string> = { pix: 'PIX', boleto: 'BOLETO', cartao: 'CREDIT_CARD', indefinida: 'UNDEFINED' };

const reais = (centavos: number) => Math.round(centavos) / 100;

export class AsaasProvedor implements ProvedorCobranca {
  readonly nome = 'asaas';
  private readonly http: typeof fetch;
  constructor(private readonly cfg: ConfigAsaas) { this.http = cfg.fetch ?? fetch; }

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await this.http(`${URL_BASE[this.cfg.ambiente]}${caminho}`, {
        method: metodo, headers: { 'content-type': 'application/json', access_token: this.cfg.chave, 'user-agent': 'JornadaCerta' }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      });
    } catch { throw new ErroCobranca('Não foi possível falar com o provedor de pagamento agora. Tente de novo em instantes.'); }
    const texto = await r.text();
    let json: unknown = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo não JSON */ }
    if (!r.ok) {
      const msg = (json as { errors?: { description?: string }[] } | null)?.errors?.[0]?.description;
      throw new ErroCobranca(msg ? `Provedor de pagamento: ${msg}` : 'O provedor de pagamento recusou o pedido.', r.status);
    }
    return json as T;
  }

  async criarCliente(c: DadosCliente): Promise<{ id: string }> {
    const doc = c.cnpj?.replace(/\D/g, '') ?? '';
    const r = await this.chamar<{ id?: string }>('POST', '/customers', { name: c.nome, ...(doc ? { cpfCnpj: doc } : {}), ...(c.email ? { email: c.email } : {}), externalReference: c.referencia, notificationDisabled: false });
    if (!r?.id) throw new ErroCobranca('Resposta inesperada do provedor de pagamento (cliente).');
    return { id: r.id };
  }

  async criarAssinatura(p: PedidoAssinatura): Promise<{ id: string }> {
    const r = await this.chamar<{ id?: string }>('POST', '/subscriptions', {
      customer: p.clienteExterno, billingType: TIPO_COBRANCA[p.forma], value: reais(p.valorCentavos), nextDueDate: p.primeiroVencimento, cycle: 'MONTHLY', description: p.descricao, externalReference: p.referencia,
    });
    if (!r?.id) throw new ErroCobranca('Resposta inesperada do provedor de pagamento (assinatura).');
    return { id: r.id };
  }

  async atualizarValor(assinaturaExterna: string, valorCentavos: number): Promise<void> {
    await this.chamar('PUT', `/subscriptions/${encodeURIComponent(assinaturaExterna)}`, { value: reais(valorCentavos), updatePendingPayments: true });
  }

  async cancelarAssinatura(assinaturaExterna: string): Promise<void> {
    try { await this.chamar('DELETE', `/subscriptions/${encodeURIComponent(assinaturaExterna)}`); }
    catch (e) { if (e instanceof ErroCobranca && e.status === 404) return; throw e; }          // já não existe: objetivo cumprido
  }
}

const EVENTOS: Record<string, TipoEvento> = {
  PAYMENT_CREATED: 'fatura_criada', PAYMENT_UPDATED: 'fatura_criada', PAYMENT_RESTORED: 'fatura_criada',
  PAYMENT_CONFIRMED: 'fatura_paga', PAYMENT_RECEIVED: 'fatura_paga',
  PAYMENT_OVERDUE: 'fatura_vencida', PAYMENT_REFUNDED: 'fatura_estornada', PAYMENT_DELETED: 'fatura_cancelada', SUBSCRIPTION_DELETED: 'assinatura_cancelada', SUBSCRIPTION_INACTIVATED: 'assinatura_cancelada',
};
const FORMA: Record<string, FormaPagamento> = { PIX: 'pix', BOLETO: 'boleto', CREDIT_CARD: 'cartao', DEBIT_CARD: 'cartao' };
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const dataIso = (v: unknown): string | null => { const t = texto(v); return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null; };

/**
 * Traduz o corpo do webhook do Asaas. Devolve null para o que não nos interessa (evento desconhecido ou corpo inválido): o
 * chamador responde 200 do mesmo jeito, para o provedor não ficar reenviando.
 */
export function lerEventoAsaas(corpo: unknown): EventoCobranca | null {
  const o = corpo as { id?: unknown; event?: unknown; payment?: Record<string, unknown>; subscription?: Record<string, unknown> } | null;
  if (!o || typeof o !== 'object') return null;
  const tipo = typeof o.event === 'string' ? EVENTOS[o.event] : undefined;
  const id = texto(o.id);
  if (!tipo || !id) return null;
  const pg = o.payment ?? {}, sub = o.subscription ?? {};
  const valor = typeof pg.value === 'number' && Number.isFinite(pg.value) ? Math.round(pg.value * 100) : null;
  const url = texto(pg.invoiceUrl) ?? texto(pg.bankSlipUrl);
  return {
    id: `asaas:${id}`, tipo,
    dados: {
      assinaturaExterna: texto(pg.subscription) ?? texto(sub.id), referencia: texto(pg.externalReference) ?? texto(sub.externalReference),
      faturaExterna: texto(pg.id), valorCentavos: valor, vencimento: dataIso(pg.dueDate),
      pagoEm: dataIso(pg.confirmedDate) ?? dataIso(pg.paymentDate) ?? dataIso(pg.clientPaymentDate), forma: FORMA[String(pg.billingType)] ?? 'indefinida', url: url && url.startsWith('https://') ? url : null,
    },
  };
}
