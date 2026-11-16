import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gerarFolhaCsv } from '@jc/documents';

type Resp = { data: unknown; error?: unknown };
let estado: { usuario: unknown; fechamento: unknown; gere: unknown; integro: unknown; empresa: unknown; auditoriaErro: boolean };
const rpcChamadas: Array<{ nome: string; args: unknown }> = [];

vi.mock('@/lib/supabase/server', () => ({
  supabaseServidor: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuario } }) },
    from: (tabela: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async (): Promise<Resp> => ({ data: tabela === 'fechamento_folha' ? estado.fechamento : estado.empresa }) }) }) }),
    rpc: async (nome: string, args: unknown): Promise<Resp> => {
      rpcChamadas.push({ nome, args });
      if (nome === 'pode_gerir_empresa') return { data: estado.gere };
      if (nome === 'fechamento_integro') return { data: estado.integro };
      return { data: null, error: estado.auditoriaErro ? { message: 'x' } : null };
    },
  }),
}));
const { GET } = await import('../app/api/v1/folha/[id]/route');

const ID = '11111111-1111-1111-1111-111111111111';
const dados = { competencia: '2027-02', linhas: [{ matricula: 'M1', nome: 'Ana', cargo: null, setor: null, diasTrabalhados: 20, trabalhadasMin: 9600, normaisMin: 9600, extrasMin: 0, adicionalHePercentual: 50, noturnasComputadasMin: 0, domingoMin: 0, feriadoMin: 0, domingosTrabalhados: 0, feriadosTrabalhados: 0, faltasMin: 0, diasFerias: 0, diasAfastamento: 0, bancoCreditoMin: 0, bancoDebitoMin: 0, bancoPagoMin: 0, bancoSaldoFinalMin: 0, bancoVencidoMin: 0, valorVencidoCentavos: 0 }], avisos: [] };
const chamar = (id = ID, q = '') => GET(new Request(`https://app.test/api/v1/folha/${id}${q}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  rpcChamadas.length = 0;
  estado = { usuario: { id: 'u' }, fechamento: { id: ID, empresa_id: 'emp', competencia: '2027-02-01', versao: 2, dados, criado_em: '2027-03-02T12:00:00Z', dados_hash: 'ab'.repeat(32) }, gere: true, integro: true, empresa: { razao_social: 'Loja Alfa Ltda', cnpj: '1' }, auditoriaErro: false };
});

describe('GET /api/v1/folha/:id', () => {
  it('CSV: devolve o arquivo do retrato fechado, com nome seguro, sem cache, e registra a exportação', async () => {
    const r = await chamar(ID, '?formato=csv');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="folha-loja-alfa-ltda-2027-02-v2.csv"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);                       // BOM: o Excel abre os acentos certos
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(gerarFolhaCsv(dados));
    expect(rpcChamadas.find((c) => c.nome === 'registrar_exportacao_folha')!.args).toEqual({ p_id: ID, p_formato: 'csv', p_layout: 'generico' });
  });
  it('XLSX: tipo correto e arquivo de verdade (começa com PK)', async () => {
    const r = await chamar(ID, '?formato=xlsx');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(r.headers.get('content-disposition')).toContain('.xlsx');
    expect(new TextDecoder().decode((await r.arrayBuffer()).slice(0, 2))).toBe('PK');
    expect(rpcChamadas.find((c) => c.nome === 'registrar_exportacao_folha')!.args).toMatchObject({ p_formato: 'xlsx' });
  });
  it('o padrão é CSV; formato desconhecido e id inválido são recusados', async () => {
    expect((await chamar(ID)).headers.get('content-type')).toContain('text/csv');
    expect((await chamar(ID, '?formato=pdf')).status).toBe(400);
    expect((await chamar('nao-e-uuid')).status).toBe(400);
  });
  it('sem login: 401; fechamento inexistente ou escondido pelo RLS: 404; sem permissão de gerir: 403', async () => {
    estado.usuario = null;
    expect((await chamar()).status).toBe(401);
    estado.usuario = { id: 'u' }; estado.fechamento = null;
    expect((await chamar()).status).toBe(404);
    estado.fechamento = { id: ID, empresa_id: 'emp', competencia: '2027-02-01', versao: 1, dados, criado_em: '', dados_hash: 'x' }; estado.gere = false;
    expect((await chamar()).status).toBe(403);
    expect(rpcChamadas.some((c) => c.nome === 'registrar_exportacao_folha')).toBe(false);          // nada é registrado nem gerado
  });
  it('fechamento que não passa na integridade não gera arquivo (409); falha ao auditar também impede o download', async () => {
    estado.integro = false;
    const r = await chamar();
    expect(r.status).toBe(409);
    expect(rpcChamadas.some((c) => c.nome === 'registrar_exportacao_folha')).toBe(false);
    estado.integro = true; estado.auditoriaErro = true;
    expect((await chamar()).status).toBe(500);
  });
});
