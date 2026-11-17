import { describe, expect, it, vi } from 'vitest';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';
import { colab } from '../../../packages/rules-engine/test/util';
import { montarDadosEscala, nomeArquivoEscala } from '@/lib/escala-export';
import type { EntradaEscala } from '@jc/servicos';

const MOD = '22222222-2222-4222-8222-222222222222';
const trab = (c: string, data: string, ini = 480, fim = 1020, inter = 60, modeloId?: string) => ({ colaboradorId: c, data, tipo: 'trabalho' as const, inicioMin: ini, fimMin: fim, intervaloMin: inter, ...(modeloId ? { modeloId } : {}) });
const folga = (c: string, data: string) => ({ colaboradorId: c, data, tipo: 'folga' as const });
const pessoa = (id: string, nome: string) => colab({ colaboradorId: id, nome, tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, salarioBaseCentavos: 300000, admissao: '2020-01-01', desligamento: null });
const entrada = (extra: Partial<EntradaEscala> = {}): EntradaEscala => ({
  escala: { id: 'e', empresaId: 'emp', setorId: null, nome: 'Março', status: 'publicada', revisao: 1, versao: 2, inicio: '2027-03-01', fim: '2027-03-07' },
  regras: REGRAS_SEED, colaboradores: [pessoa('b', 'Bia'), pessoa('a', 'Ana'), pessoa('c', 'Caio')], semContrato: [], anteriores: [], ausencias: [], feriados: [], cobertura: [],
  alocacoes: [trab('a', '2027-03-01'), trab('a', '2027-03-02', 840, 1380, 60, MOD), folga('a', '2027-03-06'), trab('b', '2027-03-01'), trab('b', '2027-03-03', 840, 1380, 60, MOD), folga('b', '2027-03-04')], ...extra,
});
const x = { empresa: { razaoSocial: 'Loja Alfa', cnpj: '12.345.678/0001-90' }, setor: null, hash: 'abc', geradoEm: '2027-02-25', nomesModelos: { [MOD]: 'Tarde' } };

describe('montarDadosEscala', () => {
  it('um código por horário (na ordem do começo), com legenda, e as pessoas em ordem alfabética', () => {
    const d = montarDadosEscala(entrada(), x);
    expect(d.linhas.map((l) => l.nome)).toEqual(['Ana', 'Bia', 'Caio']);
    expect(d.legenda).toEqual([{ codigo: 'A', indiceTurno: 0, descricao: '08:00–17:00 (intervalo 1h)' }, { codigo: 'B', indiceTurno: 1, descricao: 'Tarde 14:00–23:00 (intervalo 1h)' }]);
    expect(d.dias).toHaveLength(7);
    expect(d.dias[0]).toMatchObject({ data: '2027-03-01', diaSemana: 1, feriado: false });
    const ana = d.linhas[0]!.celulas;
    expect(ana[0]).toEqual({ texto: 'A', tipo: 'trabalho', indiceTurno: 0 });
    expect(ana[1]).toEqual({ texto: 'B', tipo: 'trabalho', indiceTurno: 1 });
    expect(ana[5]).toEqual({ texto: 'F', tipo: 'folga' });
    expect(ana[2]).toEqual({ texto: '', tipo: 'vazio' });
  });
  it('totais por pessoa (dias e horas líquidas) e pessoas trabalhando por dia', () => {
    const d = montarDadosEscala(entrada(), x);
    expect(d.linhas[0]).toMatchObject({ nome: 'Ana', diasTrabalhados: 2, horasMin: 960 });
    expect(d.linhas[2]).toMatchObject({ nome: 'Caio', diasTrabalhados: 0, horasMin: 0 });
    expect(d.cobertura).toEqual([2, 1, 1, 0, 0, 0, 0]);
  });
  it('férias e afastamento vêm das ausências mesmo sem lançamento na grade; feriado marcado; folga em dia de ausência não vira F', () => {
    const e = entrada({ ausencias: [{ colaboradorId: 'c', inicio: '2027-03-02', fim: '2027-03-03', tipo: 'ferias' }, { colaboradorId: 'b', inicio: '2027-03-05', fim: '2027-03-05', tipo: 'afastamento' }], feriados: [{ data: '2027-03-04', nome: 'X', abrangencia: 'nacional' }] });
    const d = montarDadosEscala(e, x);
    expect(d.linhas[2]!.celulas.slice(1, 3).map((c) => c.texto)).toEqual(['FÉR', 'FÉR']);
    expect(d.linhas[1]!.celulas[4]).toEqual({ texto: 'AFA', tipo: 'afastamento' });
    expect(d.dias[3]!.feriado).toBe(true);
  });
  it('dois turnos no mesmo dia aparecem juntos (A/B); sem nenhum turno a legenda fica vazia; passa adiante status, versão e código de integridade', () => {
    const e = entrada({ alocacoes: [trab('a', '2027-03-01'), trab('a', '2027-03-01', 1080, 1320, 0)] });
    const d = montarDadosEscala(e, x);
    expect(d.linhas[0]!.celulas[0]!.texto).toBe('A/B');
    expect(montarDadosEscala(entrada({ alocacoes: [] }), x).legenda).toEqual([]);
    expect(d).toMatchObject({ status: 'publicada', versao: 2, hash: 'abc', nome: 'Março', setor: null, empresa: { razaoSocial: 'Loja Alfa' } });
  });
  it('nome do arquivo seguro', () => {
    expect(nomeArquivoEscala('Açougue São João & Filhos', '2027-03-01', 2, 'pdf')).toBe('escala-acougue-sao-joao-filhos-2027-03-v2.pdf');
    expect(nomeArquivoEscala('', '2027-12-01', 1, 'xlsx')).toBe('escala-empresa-2027-12-v1.xlsx');
  });
});

describe('GET /api/v1/escalas/[id]', () => {
  const ID = '33333333-3333-4333-8333-333333333333';
  const sup = { auth: { getUser: vi.fn() }, from: vi.fn() };
  const consulta = (dado: unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'eq']) c[m] = () => c; c.maybeSingle = async () => ({ data: dado }); (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: dado }).then(ok); return c; };
  const rota = async (carregar: () => Promise<unknown>) => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({ supabaseServidor: async () => sup }));
    vi.doMock('@jc/servicos', async (orig) => ({ ...(await orig<typeof import('@jc/servicos')>()), carregarEntradaEscala: carregar }));
    return (await import('@/app/api/v1/escalas/[id]/route')).GET;
  };
  const chamar = (get: Awaited<ReturnType<typeof rota>>, id: string, q = '') => get(new Request(`http://x/api/v1/escalas/${id}${q}`), { params: Promise.resolve({ id }) });
  const preparar = () => { sup.auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u' } } }); sup.from.mockReset().mockImplementation((t: string) => consulta(t === 'empresa' ? { razao_social: 'Loja Alfa', cnpj: '12345678000190' } : t === 'escala' ? { hash_publicado: 'abc' } : t === 'turno_modelo' ? [{ id: MOD, nome: 'Tarde' }] : { nome: 'Loja' })); };

  it('PDF e Excel: tipo, nome do arquivo e conteúdo de verdade', async () => {
    preparar();
    const get = await rota(async () => entrada());
    const pdf = await chamar(get, ID);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toBe('attachment; filename="escala-loja-alfa-2027-03-v2.pdf"');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const xlsx = await chamar(get, ID, '?formato=xlsx');
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    expect(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.headers.get('cache-control')).toBe('no-store');
  });
  it('recusa id/formato inválido (400), sem login (401) e escala que não existe ou sem acesso (404)', async () => {
    preparar();
    const get = await rota(async () => entrada());
    expect((await chamar(get, 'x')).status).toBe(400);
    expect((await chamar(get, ID, '?formato=docx')).status).toBe(400);
    sup.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await chamar(get, ID)).status).toBe(401);
    const sem = await rota(async () => { throw new Error('sem permissão'); });
    expect((await chamar(sem, ID)).status).toBe(404);
  });
});
