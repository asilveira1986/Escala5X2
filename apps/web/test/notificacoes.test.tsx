// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hrefSeguro, iconeDoTipo, lerIdsLidas, tempoRelativo } from '@/lib/notificacoes';
import { Sino } from '@/components/Sino';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const AGORA = Date.parse('2027-03-10T15:00:00Z');
const n = (id: string, titulo: string, extra: Record<string, unknown> = {}) => ({ id, tipo: 'pedido_novo', titulo, texto: null, href: '/empresas/x/solicitacoes', criado_em: new Date(AGORA - 5 * 60_000).toISOString(), lida_em: null, ...extra });

describe('lib/notificacoes', () => {
  it('tempo relativo em português', () => {
    const t = (min: number) => tempoRelativo(new Date(AGORA - min * 60_000).toISOString(), AGORA);
    expect([t(0), t(5), t(90), t(60 * 30), t(60 * 24 * 3)]).toEqual(['agora', 'há 5 min', 'há 1 h', 'ontem', 'há 3 dias']);
    expect(tempoRelativo('2027-01-02T15:00:00Z', AGORA)).toBe('02/01/2027');
    expect(tempoRelativo('lixo', AGORA)).toBe('');
  });
  it('só aceita link interno', () => {
    expect(hrefSeguro('/minha-escala/pedidos')).toBe('/minha-escala/pedidos');
    expect(hrefSeguro(`/empresas/abc/solicitacoes?mes=2027-02`)).toBe('/empresas/abc/solicitacoes?mes=2027-02');
    for (const ruim of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/a b', '/<script>', null, 5, '']) expect(hrefSeguro(ruim), String(ruim)).toBeNull();
  });
  it('ícone por tipo e leitura do corpo de "marcar como lidas"', () => {
    expect([iconeDoTipo('pedido_decidido'), iconeDoTipo('escala_publicada'), iconeDoTipo('banco_vencendo'), iconeDoTipo('banco_gestao'), iconeDoTipo('cobranca_paga'), iconeDoTipo('conformidade_ec'), iconeDoTipo('escala_pendente'), iconeDoTipo('outro')]).toEqual(['pedidos', 'calendario', 'banco', 'banco', 'folha', 'diagnostico', 'calendario', 'inicio']);
    expect(lerIdsLidas(null)).toEqual({ ok: true, ids: null });
    expect(lerIdsLidas({})).toEqual({ ok: true, ids: null });
    const id = '11111111-1111-4111-8111-111111111111';
    expect(lerIdsLidas({ ids: [id] })).toEqual({ ok: true, ids: [id] });
    for (const ruim of [{ ids: [] }, { ids: ['x'] }, { ids: 'a' }, { ids: Array(201).fill(id) }, { ids: [5] }]) expect(lerIdsLidas(ruim), JSON.stringify(ruim).slice(0, 30)).toEqual({ ok: false });
  });
});

describe('Sino', () => {
  const fetchMock = vi.fn();
  const resp = (corpo: unknown, ok = true) => Promise.resolve({ ok, json: async () => corpo });
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('mostra o número de não lidas no botão e some sem notificação', () => {
    render(<Sino naoLidasInicial={3} />);
    expect(screen.getByRole('button', { name: 'Notificações, 3 não lidas' })).toBeTruthy();
    cleanup();
    render(<Sino naoLidasInicial={0} />);
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeTruthy();
  });
  it('abre, carrega a lista, mostra título/texto/link e o "ver todas"', async () => {
    fetchMock.mockImplementation(() => resp({ naoLidas: 1, itens: [n('a', 'Novo pedido de férias: Ana', { texto: 'Aguarda a sua decisão.' }), n('b', 'Escala publicada', { href: '/minha-escala', lida_em: '2027-03-10T10:00:00Z' })] }));
    render(<Sino naoLidasInicial={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    expect(await screen.findByText('Novo pedido de férias: Ana')).toBeTruthy();
    expect(screen.getByText('Aguarda a sua decisão.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Novo pedido de férias: Ana/ }).getAttribute('href')).toBe('/empresas/x/solicitacoes');
    expect(screen.getByRole('link', { name: 'Ver todas' }).getAttribute('href')).toBe('/notificacoes');
    expect(screen.getAllByRole('img', { name: 'não lida' })).toHaveLength(1);
  });
  it('clicar numa notificação marca só ela como lida e baixa o contador', async () => {
    fetchMock.mockImplementation((url: string) => (String(url).includes('/lidas') ? resp({ marcadas: 1 }) : resp({ naoLidas: 2, itens: [n('a', 'Pedido A'), n('b', 'Pedido B')] })));
    render(<Sino naoLidasInicial={2} />);
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    fireEvent.click(await screen.findByRole('link', { name: /Pedido A/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/notificacoes/lidas', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: ['a'] }) })));
    expect(screen.getByRole('button', { name: 'Notificações, 1 não lida' })).toBeTruthy();
  });
  it('"Marcar todas como lidas" zera o contador e manda pedido sem lista', async () => {
    fetchMock.mockImplementation((url: string) => (String(url).includes('/lidas') ? resp({ marcadas: 2 }) : resp({ naoLidas: 2, itens: [n('a', 'Pedido A'), n('b', 'Pedido B')] })));
    render(<Sino naoLidasInicial={2} />);
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    await screen.findByText('Pedido A');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/notificacoes/lidas', expect.objectContaining({ body: '{}' })));
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeTruthy();
    expect(screen.queryAllByRole('img', { name: 'não lida' })).toHaveLength(0);
  });
  it('lista vazia e falha de carregamento têm mensagem própria, com nova tentativa', async () => {
    fetchMock.mockImplementationOnce(() => resp({ erro: 'x' }, false));
    render(<Sino naoLidasInicial={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(await screen.findByText(/Não foi possível carregar/)).toBeTruthy();
    fetchMock.mockImplementation(() => resp({ naoLidas: 0, itens: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/Nada por aqui/)).toBeTruthy();
  });
  it('atualiza o número sozinho de tempos em tempos e Esc fecha o painel', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => resp({ naoLidas: 4 }));
    render(<Sino naoLidasInicial={0} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/notificacoes?contagem=1', expect.anything());
    expect(screen.getByRole('button', { name: 'Notificações, 4 não lidas' })).toBeTruthy();
    vi.useRealTimers();
    fetchMock.mockImplementation(() => resp({ naoLidas: 4, itens: [] }));
    fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
    expect(screen.getByRole('dialog', { name: 'Notificações' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('API de notificações', () => {
  const sup = { auth: { getUser: vi.fn() }, from: vi.fn() };
  beforeEach(() => { vi.resetModules(); sup.auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u' } } }); sup.from.mockReset(); });
  const carregar = async () => { vi.doMock('@/lib/supabase/server', () => ({ supabaseServidor: async () => sup })); return { lista: (await import('@/app/api/v1/notificacoes/route')).GET, lidas: (await import('@/app/api/v1/notificacoes/lidas/route')).POST }; };
  const cadeia = (resultado: unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'is', 'order', 'limit', 'update', 'in']) c[m] = () => c; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok); return c; };

  it('sem login: 401; com login devolve contagem e lista', async () => {
    const { lista } = await carregar();
    sup.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await lista(new Request('http://x/api/v1/notificacoes'))).status).toBe(401);
    sup.from.mockReturnValueOnce(cadeia({ count: 2, error: null })).mockReturnValueOnce(cadeia({ data: [{ id: 'a' }], error: null }));
    const r = await lista(new Request('http://x/api/v1/notificacoes?limite=5'));
    expect(await r.json()).toEqual({ naoLidas: 2, itens: [{ id: 'a' }] });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('?contagem=1 devolve só o número; tabela ausente = 503', async () => {
    const { lista } = await carregar();
    sup.from.mockReturnValueOnce(cadeia({ count: 7, error: null }));
    expect(await (await lista(new Request('http://x/api/v1/notificacoes?contagem=1'))).json()).toEqual({ naoLidas: 7 });
    sup.from.mockReturnValueOnce(cadeia({ count: null, error: { message: 'relation does not exist' } }));
    expect((await lista(new Request('http://x/api/v1/notificacoes?contagem=1'))).status).toBe(503);
  });
  it('marcar como lidas: confere origem, login e corpo; devolve quantas marcou', async () => {
    const { lidas } = await carregar();
    const pedido = (corpo: unknown, origem = 'http://x') => new Request('http://x/api/v1/notificacoes/lidas', { method: 'POST', headers: { host: 'x', origin: origem, 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    expect((await lidas(pedido({}, 'http://evil.com'))).status).toBe(403);
    expect((await lidas(pedido({ ids: ['x'] }))).status).toBe(400);
    sup.from.mockReturnValueOnce(cadeia({ data: [{ id: 'a' }, { id: 'b' }], error: null }));
    expect(await (await lidas(pedido({}))).json()).toEqual({ marcadas: 2 });
    sup.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await lidas(pedido({}))).status).toBe(401);
  });
});
