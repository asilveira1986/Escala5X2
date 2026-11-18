// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const E = '11111111-1111-4111-8111-111111111111', V1 = '22222222-2222-4222-8222-222222222222', V2 = '33333333-3333-4333-8333-333333333333', V3 = '44444444-4444-4444-8444-444444444444', U = '55555555-5555-4555-8555-555555555555';
const celula = (c: string, data: string, tipo: string, ini?: number, fim?: number) => ({ colaboradorId: c, data, tipo, inicioMin: ini ?? null, fimMin: fim ?? null, intervaloMin: tipo === 'trabalho' ? 60 : 0 });
const entradas: Record<string, unknown> = {
  [V1]: { escala: { id: V1, empresaId: E, setorId: null, nome: 'Março', status: 'substituida', versao: 1, inicio: '2027-03-01', fim: '2027-03-31' }, colaboradores: [{ colaboradorId: 'a', nome: 'Ana' }], alocacoes: [celula('a', '2027-03-01', 'trabalho', 480, 1020), celula('a', '2027-03-02', 'folga')] },
  [V2]: { escala: { id: V2, empresaId: E, setorId: null, nome: 'Março', status: 'publicada', versao: 2, inicio: '2027-03-01', fim: '2027-03-31' }, colaboradores: [{ colaboradorId: 'a', nome: 'Ana' }], alocacoes: [celula('a', '2027-03-01', 'folga'), celula('a', '2027-03-02', 'trabalho', 480, 1020)] },
  [V3]: { escala: { id: V3, empresaId: E, setorId: null, nome: 'Março', status: 'rascunho', versao: 1, inicio: '2027-03-01', fim: '2027-03-31' }, colaboradores: [{ colaboradorId: 'a', nome: 'Ana' }], alocacoes: [celula('a', '2027-03-01', 'folga'), celula('a', '2027-03-02', 'trabalho', 480, 1020)] },
};
const versoes = [
  { id: V3, nome: 'Março', status: 'rascunho', versao: 1, revisao: 3, criado_em: '2027-02-20T12:00:00Z', publicada_em: null, publicada_por: null, hash_publicado: null },
  { id: V2, nome: 'Março', status: 'publicada', versao: 2, revisao: 4, criado_em: '2027-02-10T12:00:00Z', publicada_em: '2027-02-11T12:00:00Z', publicada_por: U, hash_publicado: 'abcdef0123456789' },
  { id: V1, nome: 'Março', status: 'substituida', versao: 1, revisao: 2, criado_em: '2027-02-01T12:00:00Z', publicada_em: '2027-02-02T12:00:00Z', publicada_por: U, hash_publicado: '0123456789abcdef' },
];
const cadeia = (res: unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[m] = () => c; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok); return c; };
vi.mock('@/lib/contexto', async (orig) => ({ ...(await orig<typeof import('@/lib/contexto')>()), exigirUsuario: async () => ({ supabase: { from: (t: string) => cadeia({ data: t === 'escala' ? versoes : [{ id: U, nome: 'Rita RH' }] }) } }) }));
vi.mock('@jc/servicos', async (orig) => ({ ...(await orig<typeof import('@jc/servicos')>()), carregarEntradaEscala: async (_c: unknown, id: string) => { if (!entradas[id]) throw new Error('x'); return entradas[id]; } }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('404'); } }));
afterEach(cleanup);
beforeEach(() => vi.resetModules());

const abrir = async (escalaId: string, de?: string) => {
  const { default: Pagina } = await import('@/app/(app)/empresas/[id]/escalas/[escalaId]/historico/page');
  render(await Pagina({ params: Promise.resolve({ id: E, escalaId }), searchParams: Promise.resolve({ de }) }));
};

describe('histórico de versões da escala', () => {
  it('lista as versões com situação, quem publicou e o código de integridade', async () => {
    await abrir(V2);
    const lista = within(screen.getByRole('list', { name: 'Versões' }));
    expect(lista.getAllByRole('listitem')).toHaveLength(3);
    expect(lista.getByText('Substituída')).toBeTruthy();
    expect(lista.getAllByText(/por Rita RH/)).toHaveLength(2);
    expect(lista.getByText('abcdef012345…')).toBeTruthy();
  });
  it('compara a versão atual com a publicada anterior e mostra o que mudou', async () => {
    await abrir(V2);
    expect(screen.getByText('Versão 1 → Versão 2 (esta)')).toBeTruthy();
    const t = within(screen.getByRole('table', { name: 'Diferenças entre as versões' }));
    expect(t.getAllByText('Ana')).toHaveLength(2);
    expect(t.getByText('Folga', { selector: 'td:last-child' })).toBeTruthy();
    expect(screen.getByText('Pessoas afetadas').parentElement!.parentElement!.textContent).toContain('1');
  });
  it('a comparação pode ser escolhida na URL; rascunho idêntico à publicada não tem diferença', async () => {
    await abrir(V3, V2);
    expect(screen.getByText('As duas versões são idênticas.')).toBeTruthy();
  });
  it('primeira versão não tem com o que comparar', async () => {
    await abrir(V1);
    expect(screen.getByText('Nada para comparar')).toBeTruthy();
  });
  it('escala inexistente dá 404', async () => {
    await expect(abrir('99999999-9999-4999-8999-999999999999')).rejects.toThrow('404');
  });
});
