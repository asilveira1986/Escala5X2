import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';
import { colab } from '../../../packages/rules-engine/test/util';

const ID = '11111111-1111-4111-8111-111111111111';
let usuario: unknown = { id: 'u' }, gere: unknown = true, equipe = [colab({ colaboradorId: 'a', nome: 'Ana', setor: 'Loja', tipoEscala: '6x1', jornadaSemanalMin: 2640, folgasSemana: 1, salarioBaseCentavos: 300000 })];
const rpc = vi.fn(async (nome: string) => (nome === 'pode_gerir_empresa' ? { data: gere, error: null } : { data: { regras: REGRAS_SEED, colaboradores: equipe, semContrato: 0 }, error: null }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServidor: async () => ({ auth: { getUser: async () => ({ data: { user: usuario } }) }, rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { razao_social: 'Loja Alfa Ltda', cnpj: '12345678000190' } }) }) }) }) }) }));
vi.mock('@jc/servicos', async (orig) => ({ ...(await orig<typeof import('@jc/servicos')>()), chamar: async (c: { rpc: typeof rpc }, n: string) => (await c.rpc(n)).data, lerEntradaDiagnostico: (x: unknown) => x }));

const chamar = async (q: string) => (await import('@/app/api/v1/empresas/[id]/comunicados/route')).GET(new Request(`http://x/api?${q}`), { params: Promise.resolve({ id: ID }) });
beforeEach(() => { usuario = { id: 'u' }; gere = true; });

describe('GET comunicados', () => {
  it('recusa fase inválida, sem login e sem permissão de gestão', async () => {
    expect((await chamar('fase=F3')).status).toBe(400);
    usuario = null; expect((await chamar('fase=F1')).status).toBe(401);
    usuario = { id: 'u' }; gere = false; expect((await chamar('fase=F1')).status).toBe(403);
  });
  it('gera o PDF da fase para quem gere a empresa', async () => {
    const r = await chamar('fase=F1');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toContain('comunicados-fase1.pdf');
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('setor sem ninguém a adequar dá 404', async () => {
    expect((await chamar('fase=F1&setor=Outro')).status).toBe(404);
  });
});
