// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const E = '11111111-1111-4111-8111-111111111111';
let turnos: unknown[] = [], setores: unknown[] = [];
const cadeia = (res: unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'order']) c[m] = () => c; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok); return c; };
vi.mock('@/lib/contexto', async (orig) => ({ ...(await orig<typeof import('@/lib/contexto')>()), exigirUsuario: async () => ({ supabase: { from: (t: string) => cadeia({ data: t === 'turno_modelo' ? turnos : setores }) } }) }));
vi.mock('../app/(app)/empresas/[id]/escalas/actions', () => ({ criarEscala: vi.fn() }));
afterEach(cleanup);

const abrir = async () => { const { default: P } = await import('../app/(app)/empresas/[id]/escalas/nova/page'); render(await P({ params: Promise.resolve({ id: E }) })); };

describe('Nova escala', () => {
  it('tem cabeçalho, formulário e os três passos; volta às escalas', async () => {
    turnos = [{ id: 't' }]; setores = [{ id: 's1', nome: 'Loja' }];
    await abrir();
    expect(screen.getByRole('heading', { name: 'Nova escala' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar às escalas' }).getAttribute('href')).toBe(`/empresas/${E}/escalas`);
    expect(screen.getByLabelText('Nome')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar escala' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(/Cadastre pelo menos um turno/)).toBeNull();
  });
  it('sem turnos cadastrados orienta o cadastro', async () => {
    turnos = []; setores = [];
    await abrir();
    expect(screen.getByRole('link', { name: 'Cadastrar turno' }).getAttribute('href')).toBe(`/empresas/${E}/escalas/turnos/novo`);
  });
});
