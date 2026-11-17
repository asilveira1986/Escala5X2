import { describe, expect, it } from 'vitest';
import { AsaasProvedor, ErroCobranca, lerEventoAsaas, situacaoDaConta, type EntradaSituacao } from '../src';

const resposta = (status: number, corpo: unknown) => Promise.resolve(new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status }));
function provedor(tratar: (url: string, init: RequestInit) => Promise<Response>) {
  const chamadas: { url: string; metodo: string; corpo: unknown; cab: Record<string, string> }[] = [];
  const f = (async (url: string, init: RequestInit) => { chamadas.push({ url, metodo: String(init.method), corpo: init.body ? JSON.parse(String(init.body)) : undefined, cab: init.headers as Record<string, string> }); return tratar(url, init); }) as unknown as typeof fetch;
  return { p: new AsaasProvedor({ chave: 'chave-secreta', ambiente: 'sandbox', fetch: f }), chamadas };
}

describe('AsaasProvedor', () => {
  it('cria o cliente com CNPJ só em dígitos e a chave no cabeçalho, no endereço do sandbox', async () => {
    const { p, chamadas } = provedor(() => resposta(200, { id: 'cus_1' }));
    expect(await p.criarCliente({ nome: 'Loja Alfa', cnpj: '12.345.678/0001-90', email: 'a@b.com', referencia: 'org-1' })).toEqual({ id: 'cus_1' });
    expect(chamadas[0]).toMatchObject({ url: 'https://sandbox.asaas.com/api/v3/customers', metodo: 'POST', corpo: { name: 'Loja Alfa', cpfCnpj: '12345678000190', email: 'a@b.com', externalReference: 'org-1' } });
    expect(chamadas[0]!.cab.access_token).toBe('chave-secreta');
  });
  it('produção usa o endereço de produção', async () => {
    const f = (async (url: string) => { expect(url).toBe('https://api.asaas.com/v3/customers'); return new Response(JSON.stringify({ id: 'c' }), { status: 200 }); }) as unknown as typeof fetch;
    await new AsaasProvedor({ chave: 'k', ambiente: 'producao', fetch: f }).criarCliente({ nome: 'X', cnpj: null, email: null, referencia: 'r' });
  });
  it('cria a assinatura mensal com valor em reais e a forma de pagamento escolhida', async () => {
    const { p, chamadas } = provedor(() => resposta(200, { id: 'sub_1' }));
    expect(await p.criarAssinatura({ clienteExterno: 'cus_1', valorCentavos: 14900, forma: 'pix', primeiroVencimento: '2027-03-10', descricao: 'Plano Inicial', referencia: 'ass-1' })).toEqual({ id: 'sub_1' });
    expect(chamadas[0]!.corpo).toEqual({ customer: 'cus_1', billingType: 'PIX', value: 149, nextDueDate: '2027-03-10', cycle: 'MONTHLY', description: 'Plano Inicial', externalReference: 'ass-1' });
    for (const [forma, tipo] of [['boleto', 'BOLETO'], ['cartao', 'CREDIT_CARD'], ['indefinida', 'UNDEFINED']] as const) {
      await p.criarAssinatura({ clienteExterno: 'c', valorCentavos: 100, forma, primeiroVencimento: '2027-03-10', descricao: 'd', referencia: 'r' });
      expect((chamadas.at(-1)!.corpo as { billingType: string }).billingType).toBe(tipo);
    }
  });
  it('atualizar valor e cancelar; cancelar o que já não existe (404) não é erro', async () => {
    const { p, chamadas } = provedor((_u, i) => (i.method === 'DELETE' ? resposta(404, { errors: [{ description: 'não encontrado' }] }) : resposta(200, {})));
    await p.atualizarValor('sub_1', 39900);
    expect(chamadas[0]).toMatchObject({ metodo: 'PUT', url: 'https://sandbox.asaas.com/api/v3/subscriptions/sub_1', corpo: { value: 399, updatePendingPayments: true } });
    await expect(p.cancelarAssinatura('sub_1')).resolves.toBeUndefined();
    expect(chamadas[1]!.metodo).toBe('DELETE');
  });
  it('erro do provedor vira mensagem clara (sem vazar a chave); falha de rede também', async () => {
    const { p } = provedor(() => resposta(400, { errors: [{ description: 'CPF/CNPJ inválido' }] }));
    const e = await p.criarCliente({ nome: 'X', cnpj: '1', email: null, referencia: 'r' }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroCobranca);
    expect(e.message).toBe('Provedor de pagamento: CPF/CNPJ inválido');
    expect(e.message).not.toContain('chave-secreta');
    const rede = new AsaasProvedor({ chave: 'k', ambiente: 'sandbox', fetch: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch });
    await expect(rede.criarCliente({ nome: 'X', cnpj: null, email: null, referencia: 'r' })).rejects.toThrow(/Não foi possível falar com o provedor/);
    const sem = provedor(() => resposta(200, {}));
    await expect(sem.p.criarCliente({ nome: 'X', cnpj: null, email: null, referencia: 'r' })).rejects.toThrow(/inesperada/);
  });
});

describe('lerEventoAsaas', () => {
  const pg = { object: 'payment', id: 'pay_1', subscription: 'sub_1', customer: 'cus_1', value: 149, billingType: 'PIX', status: 'RECEIVED', dueDate: '2027-03-10', paymentDate: '2027-03-09', invoiceUrl: 'https://www.asaas.com/i/pay_1', externalReference: 'ass-1' };
  it('pagamento recebido vira fatura_paga com valor em centavos, datas, forma e link', () => {
    expect(lerEventoAsaas({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: pg })).toEqual({
      id: 'asaas:evt_1', tipo: 'fatura_paga',
      dados: { assinaturaExterna: 'sub_1', referencia: 'ass-1', faturaExterna: 'pay_1', valorCentavos: 14900, vencimento: '2027-03-10', pagoEm: '2027-03-09', forma: 'pix', url: 'https://www.asaas.com/i/pay_1' },
    });
  });
  it('mapeia os demais eventos e as formas de pagamento; boleto usa o link do boleto', () => {
    const tipo = (event: string, extra = {}) => lerEventoAsaas({ id: 'e', event, payment: { ...pg, ...extra } })?.tipo;
    expect(['PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_DELETED'].map((e) => tipo(e))).toEqual(['fatura_criada', 'fatura_paga', 'fatura_vencida', 'fatura_estornada', 'fatura_cancelada']);
    expect(lerEventoAsaas({ id: 'e', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_9' } })).toMatchObject({ tipo: 'assinatura_cancelada', dados: { assinaturaExterna: 'sub_9' } });
    const boleto = lerEventoAsaas({ id: 'e', event: 'PAYMENT_CREATED', payment: { ...pg, billingType: 'BOLETO', invoiceUrl: undefined, bankSlipUrl: 'https://www.asaas.com/b/1' } })!;
    expect(boleto.dados).toMatchObject({ forma: 'boleto', url: 'https://www.asaas.com/b/1' });
    expect(lerEventoAsaas({ id: 'e', event: 'PAYMENT_CREATED', payment: { ...pg, billingType: 'CREDIT_CARD' } })!.dados.forma).toBe('cartao');
    expect(lerEventoAsaas({ id: 'e', event: 'PAYMENT_CREATED', payment: { ...pg, billingType: 'OUTRO' } })!.dados.forma).toBe('indefinida');
  });
  it('ignora o que não interessa e nunca aceita link que não seja https', () => {
    for (const ruim of [null, 'x', 5, {}, { id: 'e', event: 'COISA' }, { event: 'PAYMENT_RECEIVED', payment: pg }, { id: 'e', event: 123 }]) expect(lerEventoAsaas(ruim), JSON.stringify(ruim)).toBeNull();
    expect(lerEventoAsaas({ id: 'e', event: 'PAYMENT_CREATED', payment: { ...pg, invoiceUrl: 'javascript:alert(1)' } })!.dados.url).toBeNull();
    expect(lerEventoAsaas({ id: 'e', event: 'PAYMENT_CREATED', payment: { id: 'p' } })!.dados).toMatchObject({ valorCentavos: null, vencimento: null, forma: 'indefinida', url: null });
  });
});

describe('situacaoDaConta', () => {
  const e = (x: Partial<EntradaSituacao>): EntradaSituacao => ({ status: 'ativa', testeAte: null, hoje: '2027-03-10', cobrancaAtiva: true, ...x });
  it('teste: conta os dias, avisa nos últimos 3 e não bloqueia; vencido sem assinatura bloqueia (se a cobrança estiver ligada)', () => {
    expect(situacaoDaConta(e({ status: 'teste', testeAte: '2027-03-20' }))).toMatchObject({ estado: 'teste', diasTeste: 10, bloqueado: false, aviso: { tom: 'info', texto: 'Teste grátis: 10 dias restantes.' } });
    expect(situacaoDaConta(e({ status: 'teste', testeAte: '2027-03-12' })).aviso?.tom).toBe('atencao');
    expect(situacaoDaConta(e({ status: 'teste', testeAte: '2027-03-10' })).aviso?.texto).toBe('Seu teste grátis termina hoje.');
    expect(situacaoDaConta(e({ status: 'teste', testeAte: '2027-03-09' }))).toMatchObject({ estado: 'teste_expirado', bloqueado: true });
    expect(situacaoDaConta(e({ status: 'teste', testeAte: '2027-03-09', cobrancaAtiva: false })).bloqueado).toBe(false);
  });
  it('inadimplente: avisa durante a carência e suspende depois; paga ou aguardando não bloqueiam', () => {
    expect(situacaoDaConta(e({ status: 'inadimplente', vencidaDesde: '2027-03-05' }))).toMatchObject({ estado: 'inadimplente', diasAtraso: 5, bloqueado: false });
    expect(situacaoDaConta(e({ status: 'inadimplente', vencidaDesde: '2027-03-03' })).estado).toBe('inadimplente');          // 7 dias: ainda na carência
    expect(situacaoDaConta(e({ status: 'inadimplente', vencidaDesde: '2027-03-02' }))).toMatchObject({ estado: 'suspensa', diasAtraso: 8, bloqueado: true });
    expect(situacaoDaConta(e({ status: 'inadimplente', vencidaDesde: '2027-01-01', cobrancaAtiva: false })).bloqueado).toBe(false);
    expect(situacaoDaConta(e({ status: 'aguardando_pagamento' })).bloqueado).toBe(false);
    expect(situacaoDaConta(e({ status: 'ativa' }))).toMatchObject({ estado: 'ativa', bloqueado: false, aviso: null });
  });
  it('cancelada bloqueia; passar do limite de colaboradores só avisa', () => {
    expect(situacaoDaConta(e({ status: 'cancelada' }))).toMatchObject({ estado: 'cancelada', bloqueado: true });
    const r = situacaoDaConta(e({ status: 'ativa', limiteColaboradores: 25, colaboradoresAtivos: 30 }));
    expect(r).toMatchObject({ excedeLimite: true, bloqueado: false });
    expect(r.aviso?.texto).toMatch(/30 colaboradores ativos e o plano inclui 25/);
    expect(situacaoDaConta(e({ limiteColaboradores: null, colaboradoresAtivos: 9999 })).excedeLimite).toBe(false);
  });
});
