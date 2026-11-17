import { beforeEach, describe, expect, it, vi } from 'vitest';

const E1 = '11111111-1111-4111-8111-111111111111', E2 = '22222222-2222-4222-8222-222222222222';
let gestao: unknown[] = [{ id: 'o' }]; let colabs = 0; let empresas: { id: string }[] = [{ id: E1 }, { id: E2 }]; let cookie: string | undefined;

vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'jc-empresa' && cookie ? { value: cookie } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock('@/lib/contexto', () => ({
  linhas: (x: unknown) => (Array.isArray(x) ? x : []),
  exigirUsuario: async () => ({
    user: { id: 'u' },
    supabase: {
      rpc: async () => ({ data: gestao }),
      from: (t: string) => (t === 'colaborador'
        ? { select: () => ({ eq: async () => ({ count: colabs }) }) }
        : { select: () => ({ order: () => ({ limit: async () => ({ data: empresas }) }) }) }),
    },
  }),
}));

const ir = async () => { const { default: Inicio } = await import('@/app/(app)/page'); try { await Inicio(); } catch (e) { return (e as Error).message.replace('REDIRECT:', ''); } return ''; };

beforeEach(() => { gestao = [{ id: 'o' }]; colabs = 0; empresas = [{ id: E1 }, { id: E2 }]; cookie = undefined; });

describe('Abertura do sistema', () => {
  it('gestor abre direto na primeira empresa quando ainda não escolheu outra', async () => { expect(await ir()).toBe(`/empresas/${E1}`); });
  it('gestor abre na última empresa que usou', async () => { cookie = E2; expect(await ir()).toBe(`/empresas/${E2}`); });
  it('cookie de empresa que não existe mais é ignorado', async () => { cookie = '33333333-3333-4333-8333-333333333333'; expect(await ir()).toBe(`/empresas/${E1}`); });
  it('gestor sem nenhuma empresa cai na lista (para cadastrar)', async () => { empresas = []; expect(await ir()).toBe('/empresas'); });
  it('colaborador sem gestão vai para a própria escala', async () => { gestao = []; colabs = 1; expect(await ir()).toBe('/minha-escala'); });
  it('conta nova (sem gestão e sem cadastro) vai para Empresas criar a organização', async () => { gestao = []; expect(await ir()).toBe('/empresas'); });
});
