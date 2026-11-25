// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn(); const criarPedido = vi.fn();
type Res = { data: unknown };
let tabelas: Record<string, unknown> = {};
const cadeia = (res: Res) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'in', 'or', 'gte', 'order', 'limit']) c[m] = () => c; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok); return c; };
vi.mock('@/lib/contexto', async (orig) => ({ ...(await orig<typeof import('@/lib/contexto')>()), exigirUsuario: async () => ({ user: { id: 'u' }, supabase: { rpc: async () => ({ data: [] }), from: (t: string) => cadeia({ data: tabelas[t] ?? [] }) } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('../app/(app)/minha-escala/pedidos/actions', () => ({ criarPedido, responderPedido: vi.fn(), cancelarPedido: vi.fn() }));
vi.mock('../app/(app)/minha-escala/actions', () => ({ darCiencia: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const pedido = (id: string, status: string, extra = {}) => ({ id, empresa_id: 'e', solicitante_id: 'c1', destinatario_id: null, solicitante_nome: 'Ana', destinatario_nome: null, tipo: 'ferias', payload: { inicio: '2027-03-01', fim: '2027-03-10' }, motivo: null, status, decisao_motivo: null, criado_em: '2027-01-20T10:00:00Z', ...extra });

describe('Meus pedidos', () => {
  beforeEach(() => { tabelas = { colaborador: [{ id: 'c1', nome: 'Ana Souza' }], solicitacao: [pedido('s1', 'pendente'), pedido('s2', 'aprovada'), pedido('s3', 'recusada'), pedido('s4', 'aguardando_colega', { solicitante_id: 'c9', destinatario_id: 'c1', solicitante_nome: 'Bia', destinatario_nome: 'Ana', tipo: 'troca_turno', payload: { dataSolicitante: '2027-02-01', dataColega: '2027-02-01' } })] }; });
  const abrir = async (sp: object = {}) => { const { default: P } = await import('../app/(app)/minha-escala/pedidos/page'); render(await P({ searchParams: Promise.resolve(sp) })); };

  it('resume, separa em andamento e encerrados e leva ao novo pedido', async () => {
    await abrir();
    const r = within(screen.getByLabelText('Resumo dos pedidos'));
    expect(r.getByText('Esperando você').parentElement!.textContent).toContain('1');
    expect(r.getByText('Aprovados').parentElement!.textContent).toContain('1');
    expect(screen.getByRole('link', { name: 'Novo pedido' }).getAttribute('href')).toBe('/minha-escala/pedidos/novo');
    expect(screen.getByText('1 pedido')).toBeTruthy();                 // só o pendente em andamento
    expect(screen.getByText('Pedidos de colegas para você')).toBeTruthy();
    expect(screen.queryByText('Aprovada')).toBeNull();
  });
  it('a aba Encerrados mostra aprovados e recusados; aviso após enviar', async () => {
    await abrir({ aba: 'encerrados', enviado: '1' });
    expect(screen.getByText('2 pedidos')).toBeTruthy();
    expect(screen.getByText('Aprovada')).toBeTruthy();
    expect(screen.getByText('Recusada')).toBeTruthy();
    expect(screen.getByText(/Pedido enviado\./)).toBeTruthy();
  });
  it('sem pedidos orienta o próximo passo', async () => {
    tabelas = { colaborador: [{ id: 'c1', nome: 'Ana' }], solicitacao: [] };
    await abrir();
    expect(screen.getByText('Nenhum pedido em andamento')).toBeTruthy();
  });
});

describe('Novo pedido', () => {
  it('tem tela própria e, ao enviar, volta para a lista', async () => {
    tabelas = { colaborador: [{ id: 'c1' }], alocacao: [] };
    criarPedido.mockResolvedValue({ ok: true });
    const { default: P } = await import('../app/(app)/minha-escala/pedidos/novo/page');
    render(await P());
    expect(screen.getByRole('heading', { name: 'Novo pedido' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar aos pedidos' }).getAttribute('href')).toBe('/minha-escala/pedidos');
    fireEvent.change(screen.getByLabelText('O que você quer pedir?'), { target: { value: 'ferias' } });
    fireEvent.change(screen.getByLabelText('Primeiro dia'), { target: { value: '2099-03-01' } });
    fireEvent.change(screen.getByLabelText(/Último dia/), { target: { value: '2099-03-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/minha-escala/pedidos?enviado=1'));
  });
});

describe('Minha escala', () => {
  it('mostra o próximo turno, o resumo e os atalhos com comunicados novos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-02-01T12:00:00Z'));   // 09:00 em São Paulo
    const alo = (data: string, tipo: string, ini: number | null, fim: number | null) => ({ escala_id: 'x', data, tipo, inicio_min: ini, fim_min: fim, intervalo_min: 60, escala: { id: 'x', nome: 'Fevereiro', periodo: '[2027-02-01,2027-03-01)', versao: 1, publicada_em: '2027-01-28T12:00:00Z', hash_publicado: 'abc' } });
    tabelas = { colaborador: [{ id: 'c1', nome: 'Ana Souza' }], alocacao: [alo('2027-02-01', 'trabalho', 480, 1020), alo('2027-02-02', 'trabalho', 480, 1020), alo('2027-02-03', 'folga', null, null)], ciencia: [], comunicado_jornada: [{ id: 'k', ciente_em: null }] };
    const { default: P } = await import('../app/(app)/minha-escala/page');
    render(await P());
    expect(screen.getByRole('heading', { name: 'Minha escala' })).toBeTruthy();
    const proximo = within(screen.getByLabelText('Seu próximo turno'));
    expect(proximo.getByText('Hoje')).toBeTruthy();
    const r = within(screen.getByLabelText('Resumo da minha escala'));
    expect(r.getByText('Dias de trabalho').parentElement!.textContent).toContain('2');
    expect(r.getByText('Horas previstas').parentElement!.textContent).toContain('16h');
    expect(r.getByText('Aguardando ciência').parentElement!.textContent).toContain('2');   // 1 escala + 1 comunicado
    const atalhos = within(screen.getByRole('navigation', { name: 'Atalhos' }));
    expect(atalhos.getByRole('link', { name: /Comunicados/ }).textContent).toContain('1 novo para ler');
    expect(atalhos.getByRole('link', { name: /Pedidos/ }).getAttribute('href')).toBe('/minha-escala/pedidos');
  });
});
