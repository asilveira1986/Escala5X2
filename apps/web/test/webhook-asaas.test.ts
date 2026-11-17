import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn(); let temServidor = true;
vi.mock('@/lib/supabase/servidor-restrito', () => ({ supabaseServidorRestrito: () => (temServidor ? { rpc } : null) }));
const pedido = (corpo: unknown, token: string | null = 'segredo') => new Request('http://x/api/webhooks/asaas', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'asaas-access-token': token } : {}) }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
const evento = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', subscription: 'sub_1', value: 149, billingType: 'PIX', dueDate: '2027-03-10', paymentDate: '2027-03-09', invoiceUrl: 'https://www.asaas.com/i/1' } };
const post = async (r: Request) => (await import('@/app/api/webhooks/asaas/route')).POST(r);
beforeEach(() => { process.env.ASAAS_WEBHOOK_TOKEN = 'segredo'; temServidor = true; rpc.mockReset().mockResolvedValue({ data: { status: 'paga' }, error: null }); });

describe('POST /api/webhooks/asaas', () => {
  it('com o segredo certo, traduz o evento e chama o banco (id com prefixo do provedor, valor em centavos)', async () => {
    const r = await post(pedido(evento));
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('aplicar_evento_cobranca', {
      p_provedor: 'asaas', p_evento_id: 'asaas:evt_1', p_tipo: 'fatura_paga',
      p_dados: { assinaturaExterna: 'sub_1', referencia: null, faturaExterna: 'pay_1', valorCentavos: 14900, vencimento: '2027-03-10', pagoEm: '2027-03-09', forma: 'pix', url: 'https://www.asaas.com/i/1' },
    });
  });
  it('segredo errado, ausente ou de tamanho diferente: 401 e nada gravado; sem segredo configurado: 503', async () => {
    for (const t of ['errado', null, 'segredo-maior-que-o-certo', '']) expect((await post(pedido(evento, t))).status, String(t)).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    delete process.env.ASAAS_WEBHOOK_TOKEN;
    expect((await post(pedido(evento))).status).toBe(503);
  });
  it('evento desconhecido ou sem id: 200 ignorado (o provedor não reenvia); corpo que não é JSON: 400', async () => {
    const a = await post(pedido({ id: 'e', event: 'COISA' }));
    expect(a.status).toBe(200); expect(await a.json()).toEqual({ ok: true, ignorado: true });
    expect((await post(pedido('isto não é json'))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('falha ao gravar: 500 (o provedor tenta de novo); sem chave de serviço: 503', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await post(pedido(evento))).status).toBe(500);
    temServidor = false;
    expect((await post(pedido(evento))).status).toBe(503);
  });
});
