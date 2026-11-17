import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';
import { colab } from '../../../packages/rules-engine/test/util';

const E = '11111111-1111-4111-8111-111111111111', ESC = '33333333-3333-4333-8333-333333333333', MODELO = '22222222-2222-4222-8222-222222222222';
const rpc = vi.fn(), inserir = vi.fn(), existente = vi.fn();
const construtor = (resultado: () => unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'is', 'limit', 'insert', 'single']) c[m] = (...a: unknown[]) => { if (m === 'insert') inserir(...a); return c; }; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok); return c; };
vi.mock('@/lib/contexto', () => ({
  exigirUsuario: async () => ({ user: { id: 'u' }, supabase: { rpc, from: () => ({ select: () => construtor(existente), insert: (...a: unknown[]) => { inserir(...a); return construtor(() => ({ data: { id: ESC }, error: null })); } }) } }),
}));
vi.mock('@jc/servicos', async (orig) => ({
  ...(await orig<typeof import('@jc/servicos')>()),
  carregarEntradaEscala: async () => ({
    escala: { id: ESC, empresaId: E, setorId: null, nome: 'x', status: 'rascunho', revisao: 4, versao: 1, inicio: '2027-03-01', fim: '2027-03-28' },
    regras: REGRAS_SEED, semContrato: [], alocacoes: [], anteriores: [], ausencias: [], feriados: [], cobertura: [],
    colaboradores: Array.from({ length: 8 }, (_, i) => colab({ colaboradorId: `p${i}`, nome: `Pessoa ${i}`, tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, salarioBaseCentavos: 300000, admissao: '2020-01-01', desligamento: null })),
  }),
}));

const turno = (extra = {}) => ({ nome: 'Manhã', inicio: '08:00', fim: '17:00', intervalo: 60, modeloId: null, minimo: [2, 4, 4, 4, 4, 4, 3], ...extra });
const pedido = (extra = {}) => ({ empresaId: E, mes: '2027-03', setorId: null, diasPorSemana: null, turnos: [turno()], ...extra });
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: 5, error: null }); inserir.mockReset(); existente.mockReset().mockReturnValue({ data: [], error: null }); });

describe('adequar (ação)', () => {
  it('cria o rascunho, calcula com o motor e grava a alocação com a revisão do rascunho', async () => {
    const { adequar } = await import('@/app/(app)/empresas/[id]/escalas/adequador/actions');
    const r = await adequar(pedido());
    expect(r).toMatchObject({ ok: true, escalaId: ESC, revisao: 5, criada: true });
    expect(inserir).toHaveBeenCalledWith(expect.objectContaining({ empresa_id: E, nome: 'Adequação 2027-03', periodo: '[2027-03-01,2027-04-01)', setor_id: null, criado_por: 'u' }));
    const [nome, args] = rpc.mock.calls[0]!;
    expect(nome).toBe('salvar_alocacoes');
    expect(args).toMatchObject({ p_escala: ESC, p_revisao: 4 });
    const grava = args.p_alocacoes as { tipo: string; inicioMin: number | null; turnoModeloId: string | null }[];
    expect(grava.length).toBeGreaterThan(100);
    expect(grava.filter((a) => a.tipo === 'trabalho').every((a) => a.inicioMin === 480)).toBe(true);
    if (r.ok) {
      expect(r.resumo.pessoasAlocadas).toBe(8);
      expect(r.grade.linhas).toHaveLength(8);
      expect(r.grade.linhas[0]!.celulas).toHaveLength(r.grade.dias.length);
      expect(r.grade.linhas[0]!.celulas.every((c) => ['0', 'F'].includes(c))).toBe(true);
    }
  });

  it('reaproveita o rascunho de adequação do mês (não cria outro) e liga o turno ao modelo cadastrado', async () => {
    existente.mockReturnValue({ data: [{ id: ESC }], error: null });
    const { adequar } = await import('@/app/(app)/empresas/[id]/escalas/adequador/actions');
    const r = await adequar(pedido({ turnos: [turno({ modeloId: MODELO })] }));
    expect(r).toMatchObject({ ok: true, criada: false });
    expect(inserir).not.toHaveBeenCalled();
    const grava = rpc.mock.calls[0]![1].p_alocacoes as { tipo: string; turnoModeloId: string | null }[];
    expect(grava.filter((a) => a.tipo === 'trabalho').every((a) => a.turnoModeloId === MODELO)).toBe(true);
  });

  it('equipe curta devolve as faltas e os avisos; pedido inválido e erro de gravação viram mensagem', async () => {
    const { adequar } = await import('@/app/(app)/empresas/[id]/escalas/adequador/actions');
    const curta = await adequar(pedido({ turnos: [turno({ minimo: [9, 9, 9, 9, 9, 9, 9] })] }));
    expect(curta.ok && curta.faltas.length > 0 && curta.avisos.join(' ').includes('Faltam')).toBe(true);
    expect(await adequar(pedido({ turnos: [] }))).toMatchObject({ ok: false });
    expect(await adequar(pedido({ turnos: [turno({ inicio: '25:00' })] }))).toMatchObject({ ok: false, erro: expect.stringContaining('Horário inválido') });
    expect(await adequar(pedido({ turnos: [turno({ minimo: [0, 0, 0, 0, 0, 0, 0] })] }))).toMatchObject({ ok: false, erro: expect.stringContaining('pelo menos um dia') });
    rpc.mockResolvedValue({ data: null, error: { message: 'row-level security' } });
    expect(await adequar(pedido())).toMatchObject({ ok: false, erro: expect.stringContaining('permissão') });
  });
});
