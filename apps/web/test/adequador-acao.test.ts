import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';
import { colab } from '../../../packages/rules-engine/test/util';

const E = '11111111-1111-4111-8111-111111111111', ESC = '33333333-3333-4333-8333-333333333333', ESC2 = '88888888-8888-4888-8888-888888888888', MODELO = '22222222-2222-4222-8222-222222222222';
const S1 = '44444444-4444-4444-8444-444444444444', S2 = '66666666-6666-4666-8666-666666666666';
const rpc = vi.fn(), inserir = vi.fn(), existente = vi.fn(), entradaDe = vi.fn();
const construtor = (resultado: () => unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'is', 'limit', 'insert', 'single']) c[m] = () => c; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok); return c; };
let novos = 0;
vi.mock('@/lib/contexto', () => ({
  exigirUsuario: async () => ({ user: { id: 'u' }, supabase: { rpc, from: () => ({ select: () => construtor(existente), insert: (...a: unknown[]) => { inserir(...a); return construtor(() => ({ data: { id: novos++ === 0 ? ESC : ESC2 }, error: null })); } }) } }),
}));
vi.mock('@jc/servicos', async (orig) => ({ ...(await orig<typeof import('@jc/servicos')>()), carregarEntradaEscala: (_c: unknown, id: string) => entradaDe(id) }));

const pessoas = (n: number, prefixo: string) => Array.from({ length: n }, (_, i) => colab({ colaboradorId: `${prefixo}${i}`, nome: `${prefixo} ${i}`, tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, salarioBaseCentavos: 300000, admissao: '2020-01-01', desligamento: null, turno: null }));
const entrada = (id: string, setorId: string, n: number, prefixo: string) => ({
  escala: { id, empresaId: E, setorId, nome: 'x', status: 'rascunho', revisao: 4, versao: 1, inicio: '2027-03-01', fim: '2027-03-28' },
  regras: REGRAS_SEED, semContrato: [], alocacoes: [], anteriores: [], ausencias: [{ colaboradorId: `${prefixo}0`, inicio: '2027-03-08', fim: '2027-03-12', tipo: 'ferias' }], feriados: [], cobertura: [], colaboradores: pessoas(n, prefixo),
});
const turnos = [{ chave: 'm', nome: 'Manhã', inicio: '08:00', fim: '17:00', intervalo: 60, modeloId: null }];
const setor = (id: string | null, nome: string, minimo = [0, 3, 3, 3, 3, 3, 0]) => ({ setorId: id, nome, minimos: { m: minimo } });
const pedido = (extra = {}) => ({ empresaId: E, mes: '2027-03', diasPorSemana: null, funcionamento: [false, true, true, true, true, true, false], fecharNosFeriados: false, turnos, setores: [setor(S1, 'Loja')], folgasFixas: {}, ...extra });
beforeEach(() => {
  novos = 0; rpc.mockReset().mockResolvedValue({ data: 5, error: null }); inserir.mockReset(); existente.mockReset().mockReturnValue({ data: [], error: null });
  entradaDe.mockReset().mockImplementation(async (id: string) => (id === ESC ? entrada(ESC, S1, 7, 'a') : entrada(ESC2, S2, 5, 'b')));
});

describe('gerarEscalas (ação)', () => {
  it('um rascunho por setor, com a alocação do setor, os dias fechados e as férias', async () => {
    const { gerarEscalas } = await import('@/app/(app)/empresas/[id]/escalas/adequador/actions');
    const r = await gerarEscalas(pedido({ setores: [setor(S1, 'Loja'), setor(S2, 'Estoque', [0, 2, 2, 2, 2, 2, 0])] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setores.map((s) => [s.setorNome, s.ok])).toEqual([['Loja', true], ['Estoque', true]]);
    expect(inserir.mock.calls.map((c) => [c[0].nome, c[0].setor_id])).toEqual([['Adequação 2027-03 · Loja', S1], ['Adequação 2027-03 · Estoque', S2]]);
    expect(rpc.mock.calls.map((c) => [c[1].p_escala, c[1].p_revisao])).toEqual([[ESC, 4], [ESC2, 4]]);
    const loja = r.setores[0]!;
    if (loja.ok) {
      expect(loja.diasFechados).toEqual(['2027-03-06', '2027-03-07', '2027-03-13', '2027-03-14', '2027-03-20', '2027-03-21', '2027-03-27', '2027-03-28']);
      expect(loja.ausencias).toEqual([expect.objectContaining({ nome: 'a 0', tipo: 'ferias', dias: 5 })]);
      expect(loja.resumo.pessoasAlocadas).toBe(7);
      const grava = rpc.mock.calls[0]![1].p_alocacoes as { colaboradorId: string; data: string; tipo: string }[];
      expect(grava.some((a) => a.tipo === 'trabalho' && ['2027-03-06', '2027-03-07'].includes(a.data))).toBe(false);            // sábado e domingo fechados
      expect(grava.some((a) => a.colaboradorId === 'a0' && a.data >= '2027-03-08' && a.data <= '2027-03-12')).toBe(false);          // férias
    }
  });

  it('folga fixa vai ao motor; rascunho existente do setor é reaproveitado', async () => {
    existente.mockReturnValue({ data: [{ id: ESC }], error: null });
    const { gerarEscalas } = await import('@/app/(app)/empresas/[id]/escalas/adequador/actions');
    const r = await gerarEscalas(pedido({ folgasFixas: { '99999999-9999-4999-8999-999999999999': [1] } }));
    expect(r.ok && r.setores[0]!.ok && (r.setores[0] as { criada: boolean }).criada).toBe(false);
    expect(inserir).not.toHaveBeenCalled();
  });

  it('um setor com problema não derruba os outros', async () => {
    entradaDe.mockImplementation(async (id: string) => (id === ESC ? { ...entrada(ESC, S1, 0, 'a') } : entrada(ESC2, S2, 5, 'b')));
    const { gerarEscalas } = await import('@/app/(app)/empresas/[id]/escalas/adequador/actions');
    const r = await gerarEscalas(pedido({ setores: [setor(S1, 'Loja'), setor(S2, 'Estoque', [0, 2, 2, 2, 2, 2, 0])] }));
    expect(r.ok && r.setores.map((s) => s.ok)).toEqual([false, true]);
    if (r.ok) expect((r.setores[0] as { erro: string }).erro).toMatch(/Não há colaboradores/);
  });

  it('empresa sem setores: rascunho da empresa toda, sem sufixo no nome', async () => {
    const { gerarEscalas } = await import('@/app/(app)/empresas/[id]/escalas/adequador/actions');
    await gerarEscalas(pedido({ setores: [setor(null, 'Empresa toda')] }));
    expect(inserir.mock.calls[0]![0]).toMatchObject({ nome: 'Adequação 2027-03', setor_id: null });
  });

  it('recusa pedido inválido e erro de gravação vira mensagem', async () => {
    const { gerarEscalas } = await import('@/app/(app)/empresas/[id]/escalas/adequador/actions');
    expect(await gerarEscalas(pedido({ turnos: [] }))).toMatchObject({ ok: false });
    expect(await gerarEscalas(pedido({ setores: [] }))).toMatchObject({ ok: false, erro: expect.stringContaining('setor') });
    expect(await gerarEscalas(pedido({ funcionamento: [true] }))).toMatchObject({ ok: false });
    expect(await gerarEscalas(pedido({ turnos: [{ ...turnos[0], inicio: '25:00' }] }))).toMatchObject({ ok: false, erro: expect.stringContaining('Horário inválido') });
    rpc.mockResolvedValue({ data: null, error: { message: 'row-level security' } });
    const r = await gerarEscalas(pedido());
    expect(r.ok && !r.setores[0]!.ok && (r.setores[0] as { erro: string }).erro).toMatch(/permissão/);
  });
});
