// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '11111111-1111-4111-8111-111111111111';
const rpc = vi.fn(); let comunicados: unknown[] = [];
const cadeia = (res: unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok); return c; };
vi.mock('@/lib/contexto', async (orig) => ({ ...(await orig<typeof import('@/lib/contexto')>()), exigirUsuario: async () => ({ user: { id: 'u' }, supabase: { rpc, from: (t: string) => cadeia({ data: t === 'colaborador' ? [{ id: 'c1', nome: 'Ana Souza' }] : comunicados }) } }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
afterEach(cleanup);
beforeEach(() => { rpc.mockReset().mockResolvedValue({ error: null }); comunicados = [{ id: ID, fase: 'F1', inicio: '2026-12-15', jornada_atual_min: 2640, nova_jornada_min: 2520, dias_trabalho: 5, dias_repouso: 2, emitido_em: '2026-11-20T12:00:00Z', ciente_em: null }]; });

const abrir = async () => { const { default: P } = await import('@/app/(app)/minha-escala/comunicados/page'); render(await P()); };

describe('meus comunicados', () => {
  it('mostra o texto do comunicado e deixa confirmar a ciência', async () => {
    await abrir();
    expect(screen.getByText(/de 44h para 42h/)).toBeTruthy();
    expect(screen.getByText('Aguardando a sua ciência')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Li e estou ciente' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('registrar_ciencia_comunicado', { p_id: ID }));
  });
  it('com ciência registrada não oferece o botão', async () => {
    comunicados = [{ ...(comunicados[0] as object), ciente_em: '2026-11-21T15:00:00Z' }];
    await abrir();
    expect(screen.getByText('Ciência registrada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Li e estou ciente' })).toBeNull();
    expect(screen.getByText(/Você confirmou a ciência em/)).toBeTruthy();
  });
  it('sem comunicados mostra o estado vazio', async () => {
    comunicados = [];
    await abrir();
    expect(screen.getByText('Nenhum comunicado')).toBeTruthy();
  });
  it('a ação recusa id inválido e traduz erro do banco', async () => {
    const { darCienciaComunicado } = await import('@/app/(app)/minha-escala/actions');
    expect(await darCienciaComunicado('x')).toEqual({ ok: false, erro: 'Pedido inválido.' });
    rpc.mockResolvedValue({ error: { message: 'Comunicado não encontrado.' } });
    expect(await darCienciaComunicado(ID)).toEqual({ ok: false, erro: 'Comunicado não encontrado.' });
    rpc.mockResolvedValue({ error: { message: 'boom' } });
    expect((await darCienciaComunicado(ID))).toMatchObject({ ok: false, erro: expect.stringContaining('Tente de novo') });
  });
});
