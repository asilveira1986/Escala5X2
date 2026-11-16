import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Resp = { data: unknown; error?: { message: string } | null };
let estado: { usuario: unknown; gere: unknown; cnpj: string; iniciar: Resp; importar: (lote: unknown[]) => Resp; finalizar: Resp };
const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase/server', () => ({
  supabaseServidor: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuario } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { cnpj: estado.cnpj } }) }) }) }),
    rpc: async (nome: string, args: Record<string, unknown>): Promise<Resp> => {
      chamadas.push({ nome, args });
      switch (nome) {
        case 'pode_gerir_empresa': return { data: estado.gere };
        case 'iniciar_importacao_afd': return estado.iniciar;
        case 'importar_marcacoes_afd': return estado.importar(args.p_marcacoes as unknown[]);
        case 'finalizar_importacao_afd': return estado.finalizar;
        case 'identificadores_pendentes': return { data: [{ x: 1 }, { x: 2 }] };
        default: return { data: 0 };
      }
    },
  }),
}));
const { POST } = await import('../app/api/v1/ponto/importar/route');

// ---- arquivo AFD no leiaute 1510 (PIS válido, CNPJ 11.222.333/0001-81)
const PIS = '12345678919';
const pad = (n: number, t: number) => String(n).padStart(t, '0');
const cab = (cnpj = '11222333000181') => `000000000${'1'}1${cnpj}${' '.repeat(12)}${'EMPRESA'.padEnd(150)}${'RUA'.padEnd(100)}0102202728022027150320270900`;
const marca = (nsr: number, hh: string, mi: string) => `${pad(nsr, 9)}3010220${'26'}${hh}${mi}0${PIS}`;
const trailer = (n: number) => `000000000${'9'}${pad(0, 9)}${pad(n, 9)}${pad(0, 9)}${pad(0, 9)}`;
const afd = (linhas: string[], c = cab()) => [c, ...linhas, trailer(linhas.filter((l) => l[9] === '3').length)].join('\r\n') + '\r\n';
const EMP = '11111111-1111-1111-1111-111111111111';

function pedido(texto: string | Uint8Array, extra: Record<string, string> = {}, nome = 'afd.txt') {
  const f = new FormData();
  f.set('empresaId', extra.empresaId ?? EMP);
  if (extra.sem !== 'arquivo') f.set('arquivo', new File([texto as BlobPart], nome, { type: 'text/plain' }));
  if (extra.parcial) f.set('parcial', extra.parcial);
  return new Request('https://app.test/api/v1/ponto/importar', { method: 'POST', body: f });
}

beforeEach(() => {
  chamadas.length = 0;
  estado = { usuario: { id: 'u' }, gere: true, cnpj: '11.222.333/0001-81', iniciar: { data: 'imp-1' }, importar: (l) => ({ data: { inseridas: l.length, jaExistiam: 0 } }), finalizar: { data: null } };
});

describe('POST /api/v1/ponto/importar', () => {
  it('importa um AFD válido: hash do arquivo, marcações sem nome de pessoa, relatório e finalização', async () => {
    const texto = afd([marca(1, '08', '00'), marca(2, '12', '00')]);
    const r = await POST(pedido(texto));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, importacaoId: 'imp-1', dialeto: 'portaria_1510', marcacoesLidas: 2, inseridas: 2, naoReconhecidos: 2, periodo: { inicio: '2026-02-01', fim: '2026-02-01' } });
    const ini = chamadas.find((c) => c.nome === 'iniciar_importacao_afd')!.args;
    expect(ini).toMatchObject({ p_empresa: EMP, p_nome: 'afd.txt', p_dialeto: 'portaria_1510', p_hash: createHash('sha256').update(texto).digest('hex') });
    const lote = chamadas.find((c) => c.nome === 'importar_marcacoes_afd')!.args.p_marcacoes as Array<Record<string, unknown>>;
    expect(lote[0]).toEqual({ momento: '2026-02-01T11:00:00.000Z', nsr: 1, tipo: 'pis', identificador: PIS });
    expect(chamadas.find((c) => c.nome === 'finalizar_importacao_afd')!.args).toMatchObject({ p_importacao: 'imp-1', p_status: 'concluida' });
  });
  it('arquivo grande vai em lotes de 4.000 marcações', async () => {
    const linhas = Array.from({ length: 4001 }, (_, i) => marca(i + 1, pad(8 + (i % 10), 2), pad(i % 60, 2)));
    const j = await (await POST(pedido(afd(linhas)))).json();
    const lotes = chamadas.filter((c) => c.nome === 'importar_marcacoes_afd').map((c) => (c.args.p_marcacoes as unknown[]).length);
    expect(lotes.reduce((a, b) => a + b, 0)).toBe(j.marcacoesLidas);
    expect(lotes.every((n) => n <= 4000)).toBe(true);
    expect(lotes.length).toBeGreaterThanOrEqual(1);
  });
  it('recusas simples: sem login, empresa inválida, sem arquivo, arquivo grande demais, sem permissão', async () => {
    estado.usuario = null;
    expect((await POST(pedido(afd([marca(1, '08', '00')])))).status).toBe(401);
    estado.usuario = { id: 'u' };
    expect((await POST(pedido('x', { empresaId: 'nao-uuid' }))).status).toBe(400);
    expect((await POST(pedido('x', { sem: 'arquivo' }))).status).toBe(400);
    expect((await POST(pedido(new Uint8Array(10 * 1024 * 1024 + 1)))).status).toBe(413);
    estado.gere = false;
    expect((await POST(pedido(afd([marca(1, '08', '00')])))).status).toBe(403);
    expect(chamadas.some((c) => c.nome === 'iniciar_importacao_afd')).toBe(false);
  });
  it('arquivo que não é AFD: 422 com o motivo, sem tocar no banco', async () => {
    const r = await POST(pedido('Nome;CPF\r\nAna;1\r\n'));
    const j = await r.json();
    expect(r.status).toBe(422);
    expect(j.erros[0].mensagem).toMatch(/não é um cabeçalho de AFD/);
    expect(chamadas.some((c) => c.nome === 'iniciar_importacao_afd')).toBe(false);
  });
  it('linhas fora do leiaute: recusa o arquivo todo; com "parcial" importa só o válido e informa o resto', async () => {
    const texto = afd([marca(1, '08', '00'), '000000002' + '3' + 'lixo', marca(3, '12', '00')]);
    const r = await POST(pedido(texto));
    const j = await r.json();
    expect(r.status).toBe(422);
    expect(j).toMatchObject({ podeParcial: true, erros: [expect.objectContaining({ linha: 3 })] });
    expect(chamadas.some((c) => c.nome === 'iniciar_importacao_afd')).toBe(false);
    chamadas.length = 0;
    const p = await POST(pedido(texto, { parcial: '1' }));
    const jp = await p.json();
    expect(p.status).toBe(200);
    expect(jp).toMatchObject({ marcacoesLidas: 2, errosTotal: 1, parcial: true });
  });
  it('AFD de outra empresa (CNPJ diferente) é recusado', async () => {
    const r = await POST(pedido(afd([marca(1, '08', '00')], cab('99888777000166'))));
    expect(r.status).toBe(422);
    expect((await r.json()).erro).toMatch(/CNPJ do arquivo é diferente/);
    expect(chamadas.some((c) => c.nome === 'iniciar_importacao_afd')).toBe(false);
  });
  it('o mesmo arquivo importado de novo: 409 com a mensagem do banco', async () => {
    estado.iniciar = { data: null, error: { message: 'Este mesmo arquivo já foi importado em 02/03/2027.' } };
    const r = await POST(pedido(afd([marca(1, '08', '00')])));
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toBe('Este mesmo arquivo já foi importado em 02/03/2027.');
    expect(chamadas.some((c) => c.nome === 'importar_marcacoes_afd')).toBe(false);
  });
  it('falha no meio da importação: desfaz tudo e responde 500', async () => {
    estado.importar = () => ({ data: null, error: { message: 'timeout' } });
    const r = await POST(pedido(afd([marca(1, '08', '00')])));
    expect(r.status).toBe(500);
    expect((await r.json()).erro).toMatch(/foi desfeita/);
    expect(chamadas.find((c) => c.nome === 'desfazer_importacao_afd')!.args).toMatchObject({ p_importacao: 'imp-1' });
    expect(chamadas.some((c) => c.nome === 'finalizar_importacao_afd')).toBe(false);
  });
  it('não consegue encerrar o registro: avisa que as marcações entraram', async () => {
    estado.finalizar = { data: null, error: { message: 'x' } };
    const r = await POST(pedido(afd([marca(1, '08', '00')])));
    expect(r.status).toBe(500);
    expect((await r.json()).erro).toMatch(/marcações entraram/);
  });
});
