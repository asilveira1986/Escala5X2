// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111', PLANO = '22222222-2222-4222-8222-222222222222', ASS = '33333333-3333-4333-8333-333333333333';
const refresh = vi.fn(), rpcServidor = vi.fn(), provedor = { nome: 'asaas', criarCliente: vi.fn(), criarAssinatura: vi.fn(), atualizarValor: vi.fn(), cancelarAssinatura: vi.fn() };
let papel: string | null = 'admin', assinatura: Record<string, unknown> | null = null, servidorOk = true, provedorOk = true;
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), usePathname: () => '/empresas' }));
vi.mock('@/lib/supabase/servidor-restrito', () => ({ supabaseServidorRestrito: () => (servidorOk ? { rpc: rpcServidor } : null) }));
vi.mock('@/lib/cobranca', async (orig) => ({ ...(await orig<typeof import('@/lib/cobranca')>()), provedorDeCobranca: () => (provedorOk ? provedor : null) }));
const consulta = (dados: () => unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'eq']) c[m] = () => c; c.maybeSingle = async () => ({ data: dados() }); return c; };
const linhaDe = (t: string): unknown => {
  if (t === 'membro') return papel ? { papel } : null;
  if (t === 'assinatura') return assinatura;
  if (t === 'plano') return { id: PLANO, nome: 'Inicial', preco_centavos: 14900 };
  return { id: ORG, nome: 'Loja Alfa', cnpj: '12.345.678/0001-90' };
};
vi.mock('@/lib/contexto', () => ({
  exigirUsuario: async () => ({ user: { id: 'u', email: 'adm@x.com' }, supabase: { from: (t: string) => consulta(() => linhaDe(t)) } }),
}));

beforeEach(() => {
  papel = 'admin'; servidorOk = true; provedorOk = true; refresh.mockClear(); rpcServidor.mockReset().mockResolvedValue({ data: null, error: null });
  assinatura = { id: ASS, status: 'teste', plano_id: PLANO, teste_ate: '2099-01-20', cliente_externo: null, assinatura_externa: null };
  provedor.criarCliente.mockReset().mockResolvedValue({ id: 'cus_1' }); provedor.criarAssinatura.mockReset().mockResolvedValue({ id: 'sub_1' }); provedor.atualizarValor.mockReset().mockResolvedValue(undefined); provedor.cancelarAssinatura.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
const acoes = () => import('@/app/(app)/cobranca/actions');

describe('assinar', () => {
  it('cria cliente e assinatura no provedor (primeiro vencimento ao fim do teste) e registra no banco', async () => {
    const { assinar } = await acoes();
    const r = await assinar(ORG, PLANO, 'pix');
    expect(r).toMatchObject({ ok: true });
    expect(provedor.criarCliente).toHaveBeenCalledWith({ nome: 'Loja Alfa', cnpj: '12.345.678/0001-90', email: 'adm@x.com', referencia: ORG });
    expect(provedor.criarAssinatura).toHaveBeenCalledWith({ clienteExterno: 'cus_1', valorCentavos: 14900, forma: 'pix', primeiroVencimento: '2099-01-20', descricao: 'JornadaCerta — plano Inicial', referencia: ASS });
    expect(rpcServidor).toHaveBeenCalledWith('definir_assinatura', { p_org: ORG, p_plano: PLANO, p_provedor: 'asaas', p_cliente: 'cus_1', p_assinatura: 'sub_1', p_forma: 'pix', p_vencimento: '2099-01-20' });
  });
  it('teste já vencido: a primeira cobrança vence amanhã; cliente já existente é reaproveitado', async () => {
    assinatura = { ...assinatura!, teste_ate: '2000-01-01', cliente_externo: 'cus_antigo', status: 'cancelada' };
    const { assinar } = await acoes();
    await assinar(ORG, PLANO, 'boleto');
    expect(provedor.criarCliente).not.toHaveBeenCalled();
    const venc = provedor.criarAssinatura.mock.calls[0]![0].primeiroVencimento as string;
    expect(venc > new Date().toISOString().slice(0, 10)).toBe(true);
  });
  it('só admin; sem configuração; assinatura já em andamento; pedido inválido; erro do provedor', async () => {
    const { assinar } = await acoes();
    papel = 'rh';
    expect(await assinar(ORG, PLANO, 'pix')).toMatchObject({ ok: false, erro: expect.stringContaining('administrador') });
    papel = 'admin'; provedorOk = false;
    expect(await assinar(ORG, PLANO, 'pix')).toMatchObject({ ok: false, erro: expect.stringContaining('não está configurada') });
    provedorOk = true; assinatura = { ...assinatura!, status: 'ativa', assinatura_externa: 'sub_0' };
    expect(await assinar(ORG, PLANO, 'pix')).toMatchObject({ ok: false, erro: expect.stringContaining('Trocar de plano') });
    expect(await assinar('x', PLANO, 'pix')).toEqual({ ok: false, erro: 'Pedido inválido.' });
    expect(await assinar(ORG, PLANO, 'ouro' as never)).toEqual({ ok: false, erro: 'Pedido inválido.' });
    assinatura = { ...assinatura!, status: 'teste', assinatura_externa: null };
    const { ErroCobranca } = await import('@jc/servicos');
    provedor.criarCliente.mockRejectedValue(new ErroCobranca('Provedor de pagamento: CPF/CNPJ inválido'));
    expect(await assinar(ORG, PLANO, 'pix')).toEqual({ ok: false, erro: 'Provedor de pagamento: CPF/CNPJ inválido' });
    expect(rpcServidor).not.toHaveBeenCalled();
  });
  it('se o provedor criou mas o banco falhou, avisa para não tentar de novo às cegas', async () => {
    rpcServidor.mockResolvedValue({ data: null, error: { message: 'x' } });
    const { assinar } = await acoes();
    expect(await assinar(ORG, PLANO, 'pix')).toMatchObject({ ok: false, erro: expect.stringContaining('Fale com o suporte') });
  });
});

describe('trocar plano e cancelar', () => {
  it('troca: muda o valor no provedor e o plano no banco; durante o teste (sem provedor) só o plano', async () => {
    const { trocarPlano } = await acoes();
    assinatura = { ...assinatura!, status: 'ativa', assinatura_externa: 'sub_1' };
    expect(await trocarPlano(ORG, PLANO)).toMatchObject({ ok: true });
    expect(provedor.atualizarValor).toHaveBeenCalledWith('sub_1', 14900);
    expect(rpcServidor).toHaveBeenCalledWith('trocar_plano_assinatura', { p_org: ORG, p_plano: PLANO });
    provedor.atualizarValor.mockClear();
    assinatura = { ...assinatura!, status: 'teste', assinatura_externa: null };
    expect(await trocarPlano(ORG, PLANO)).toMatchObject({ ok: true });
    expect(provedor.atualizarValor).not.toHaveBeenCalled();
  });
  it('cancelar: cancela no provedor e no banco; só admin', async () => {
    const { cancelarAssinatura } = await acoes();
    assinatura = { ...assinatura!, status: 'ativa', assinatura_externa: 'sub_1' };
    expect(await cancelarAssinatura(ORG)).toMatchObject({ ok: true });
    expect(provedor.cancelarAssinatura).toHaveBeenCalledWith('sub_1');
    expect(rpcServidor).toHaveBeenCalledWith('cancelar_assinatura_cobranca', { p_org: ORG });
    papel = 'colaborador';
    expect(await cancelarAssinatura(ORG)).toMatchObject({ ok: false });
  });
});

describe('botões de plano', () => {
  it('sem assinatura: escolhe a forma e assina; com assinatura: troca; plano atual é só um selo', async () => {
    const { EscolhaPlano } = await import('@/app/(app)/cobranca/AcoesCobranca');
    render(<EscolhaPlano orgId={ORG} planoId={PLANO} atual={false} emAndamento={false} rotulo="Inicial" />);
    fireEvent.change(screen.getByLabelText('Forma de pagamento'), { target: { value: 'boleto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assinar o plano Inicial' }));
    await waitFor(() => expect(provedor.criarAssinatura).toHaveBeenCalledWith(expect.objectContaining({ forma: 'boleto' })));
    expect(await screen.findByText(/Assinatura criada/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    cleanup();
    render(<EscolhaPlano orgId={ORG} planoId={PLANO} atual emAndamento rotulo="Inicial" />);
    expect(screen.getByText('Seu plano atual')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Shell com cobrança', () => {
  const montar = async (cobranca: Record<string, unknown>) => {
    const { Shell } = await import('@/components/Shell');
    return render(<Shell cobranca={cobranca as never} email="a@b.c" empresas={[]} ehGestor temMinhaEscala={false} temCarteira estadoInicial={{ recolhido: false, abertos: [] }}><p>conteúdo da página</p></Shell>);
  };
  it('mostra a faixa de aviso com link para Plano e cobrança, sem bloquear', async () => {
    await montar({ aviso: { tom: 'atencao', texto: 'Teste grátis: 2 dias restantes.' }, bloqueado: false });
    expect(screen.getByText('Teste grátis: 2 dias restantes.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Plano e cobrança' }).some((l) => l.getAttribute('href') === '/cobranca')).toBe(true);
    expect(screen.getByText('conteúdo da página')).toBeTruthy();
  });
  it('bloqueado: troca o conteúdo pela tela de acesso suspenso (o menu e o botão Sair continuam)', async () => {
    await montar({ aviso: { tom: 'risco', texto: 'O período de teste terminou.' }, bloqueado: true });
    expect(screen.getByRole('alert').textContent).toMatch(/Acesso suspenso/);
    expect(screen.queryByText('conteúdo da página')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ir para Plano e cobrança' }).getAttribute('href')).toBe('/cobranca');
    expect(screen.getByRole('navigation', { name: 'Menu principal' })).toBeTruthy();
  });
});
