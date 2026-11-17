// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { limitesDoMes } from '@/lib/banco-ponto-dados';

const E = '11111111-1111-4111-8111-111111111111', A = '22222222-2222-4222-8222-222222222222', B = '33333333-3333-4333-8333-333333333333';
const apurar = vi.fn(), lancar = vi.fn(), refresh = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/contexto', () => ({ exigirUsuario: async () => ({ supabase: {}, user: { id: 'u' } }) }));
vi.mock('@/lib/banco-ponto-dados', async (orig) => ({ ...(await orig<typeof import('@/lib/banco-ponto-dados')>()), calcularApuracao: (...a: unknown[]) => apurar(...a) }));
vi.mock('@jc/servicos', () => ({ lancarBancoPonto: (...a: unknown[]) => lancar(...a) }));

const item = (c: string, data: string, minutos: number, jaLancado = false) => ({ colaboradorId: c, nome: c === A ? 'Ana' : 'Bia', data, minutos, previstoMin: 480, efetivoMin: 480 + minutos, motivo: `Ponto: x (${minutos > 0 ? '+' : '−'}0h30)`, jaLancado });
beforeEach(() => { refresh.mockClear(); lancar.mockReset().mockResolvedValue({ lancados: 2, recusados: [] }); apurar.mockReset().mockResolvedValue({ inicio: '2027-02-01', fim: '2027-02-28', completo: true, temEscala: true, temMarcacoes: true, itens: [item(A, '2027-02-01', -30), item(A, '2027-02-02', 60), item(B, '2027-02-02', 30, true)] }); });
afterEach(cleanup);

describe('limitesDoMes', () => {
  it('primeiro e último dia, inclusive ano bissexto e dezembro', () => {
    expect(limitesDoMes('2027-02')).toEqual({ inicio: '2027-02-01', fim: '2027-02-28' });
    expect(limitesDoMes('2028-02')).toEqual({ inicio: '2028-02-01', fim: '2028-02-29' });
    expect(limitesDoMes('2027-12')).toEqual({ inicio: '2027-12-01', fim: '2027-12-31' });
    expect(limitesDoMes('2027-04').fim).toBe('2027-04-30');
  });
});

describe('lancarApuracao (ação)', () => {
  it('o servidor refaz a apuração e só lança o que ela propõe: ignora dia já lançado e dia que não existe na apuração', async () => {
    const { lancarApuracao } = await import('@/app/(app)/empresas/[id]/banco-horas/ponto/actions');
    const r = await lancarApuracao(E, '2027-02', [{ colaboradorId: A, data: '2027-02-01' }, { colaboradorId: B, data: '2027-02-02' }, { colaboradorId: A, data: '2027-02-15' }]);
    expect(r).toEqual({ ok: true, lancados: 2, recusados: [] });
    expect(apurar).toHaveBeenCalledWith(expect.anything(), E, '2027-02');
    const itens = lancar.mock.calls[0]![2] as { colaboradorId: string; data: string; minutos: number }[];
    expect(itens.map((i) => [i.colaboradorId, i.data, i.minutos])).toEqual([[A, '2027-02-01', -30]]);    // os minutos vêm da apuração, não do pedido
  });
  it('recusa pedido vazio, mês inválido, nada disponível e dados incompletos', async () => {
    const { lancarApuracao } = await import('@/app/(app)/empresas/[id]/banco-horas/ponto/actions');
    expect(await lancarApuracao(E, '2027-02', [])).toMatchObject({ ok: false });
    expect(await lancarApuracao(E, '2027-13', [{ colaboradorId: A, data: '2027-02-01' }])).toEqual({ ok: false, erro: 'Pedido inválido.' });
    expect(await lancarApuracao(E, '2027-02', [{ colaboradorId: B, data: '2027-02-02' }])).toMatchObject({ ok: false, erro: expect.stringContaining('Nenhum dos dias') });
    apurar.mockResolvedValue({ inicio: '', fim: '', completo: false, temEscala: true, temMarcacoes: true, itens: [] });
    expect(await lancarApuracao(E, '2027-02', [{ colaboradorId: A, data: '2027-02-01' }])).toMatchObject({ ok: false, erro: expect.stringContaining('todos os dados') });
    expect(lancar).not.toHaveBeenCalled();
  });
  it('permissão negada vira mensagem clara', async () => {
    lancar.mockRejectedValue(new Error('sem permissão'));
    const { lancarApuracao } = await import('@/app/(app)/empresas/[id]/banco-horas/ponto/actions');
    expect(await lancarApuracao(E, '2027-02', [{ colaboradorId: A, data: '2027-02-01' }])).toEqual({ ok: false, erro: expect.stringContaining('permissão') });
  });
});

describe('ListaApuracao', () => {
  const montar = async (podeGerir = true) => {
    const { ListaApuracao } = await import('@/app/(app)/empresas/[id]/banco-horas/ponto/ListaApuracao');
    const { itens } = await apurar();
    return render(<ListaApuracao empresaId={E} mes="2027-02" podeGerir={podeGerir} linhas={itens} />);
  };
  it('vem tudo marcado (menos o já lançado), mostra o total e lança só os marcados', async () => {
    await montar();
    expect(screen.getByRole('button', { name: 'Lançar 2 dias no banco de horas' })).toBeTruthy();
    expect(screen.getByText('já lançado')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Lançar Ana em 01/02/2027'));
    fireEvent.click(screen.getByRole('button', { name: 'Lançar 1 dia no banco de horas' }));
    await waitFor(() => expect(lancar).toHaveBeenCalled());
    expect(await screen.findByText(/2 dia\(s\) lançado\(s\)/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
  it('mostra os recusados com o motivo e o nome', async () => {
    lancar.mockResolvedValue({ lancados: 1, recusados: [{ colaboradorId: A, data: '2027-02-02', motivo: 'Sem acordo com banco de horas vigente' }] });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Lançar 2 dias/ }));
    expect(await screen.findByText(/Sem acordo com banco de horas vigente/)).toBeTruthy();
    expect(screen.getByText(/1 não puderam ser lançados/)).toBeTruthy();
  });
  it('sem permissão de gestão não há caixas nem botão', async () => {
    await montar(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Lançar/ })).toBeNull();
  });
});
