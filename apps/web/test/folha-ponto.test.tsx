// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const E = '11111111-1111-4111-8111-111111111111';
const fechar = vi.fn(), carregarBase = vi.fn(), calcular = vi.fn(), carregarMarc = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/contexto', () => ({ exigirUsuario: async () => ({ supabase: {}, user: { id: 'u' } }) }));
vi.mock('@/lib/folha-dados', () => ({ carregarMarcacoes: (...a: unknown[]) => carregarMarc(...a) }));
vi.mock('@jc/servicos', () => ({
  carregarBaseFechamento: (...a: unknown[]) => carregarBase(...a), calcularFechamento: (...a: unknown[]) => calcular(...a),
  fecharFolha: (...a: unknown[]) => fechar(...a), podeFechar: () => true,
}));

beforeEach(() => {
  fechar.mockReset().mockResolvedValue('id'); carregarMarc.mockReset().mockResolvedValue({ marcacoes: [{ colaborador_id: 'a', momento: '2020-01-01T11:00:00Z' }], completo: true });
  carregarBase.mockReset().mockResolvedValue({ base: { inicio: '2020-01-01', fim: '2020-01-31', versao_vigente: null }, entradas: [] });
  calcular.mockReset().mockReturnValue({ avisos: [], linhas: [{}] });
});
afterEach(cleanup);

describe('fecharMes com origem das horas', () => {
  it('pelo ponto: lê as marcações, calcula com a origem e a opção de dia sem marcação, e fecha', async () => {
    const { fecharMes } = await import('@/app/(app)/empresas/[id]/folha/actions');
    const r = await fecharMes(E, '2020-01', '', 'ponto', 'falta');
    expect(r.ok).toBe(true);
    expect(carregarMarc).toHaveBeenCalledWith(expect.anything(), E, '2020-01-01', '2020-01-31');
    expect(calcular).toHaveBeenCalledWith(expect.anything(), [], { origem: 'ponto', marcacoes: [{ colaborador_id: 'a', momento: '2020-01-01T11:00:00Z' }], semMarcacao: 'falta' });
  });
  it('pela escala: não toca nas marcações (padrão de antes)', async () => {
    const { fecharMes } = await import('@/app/(app)/empresas/[id]/folha/actions');
    expect((await fecharMes(E, '2020-01', '')).ok).toBe(true);
    expect(carregarMarc).not.toHaveBeenCalled();
    expect(calcular).toHaveBeenCalledWith(expect.anything(), [], { origem: 'escala', marcacoes: [], semMarcacao: 'escala' });
  });
  it('marcações incompletas (erro ou truncadas) impedem o fechamento pelo ponto', async () => {
    carregarMarc.mockResolvedValue({ marcacoes: [], completo: false });
    const { fecharMes } = await import('@/app/(app)/empresas/[id]/folha/actions');
    const r = await fecharMes(E, '2020-01', '', 'ponto');
    expect(r).toMatchObject({ ok: false });
    expect(fechar).not.toHaveBeenCalled();
  });
  it('origem inválida é recusada', async () => {
    const { fecharMes } = await import('@/app/(app)/empresas/[id]/folha/actions');
    expect(await fecharMes(E, '2020-01', '', 'xx' as never)).toEqual({ ok: false, erro: 'Pedido inválido.' });
  });
});

describe('BotaoFechar', () => {
  it('diz de onde vêm as horas e envia a origem escolhida', async () => {
    const { BotaoFechar } = await import('@/app/(app)/empresas/[id]/folha/BotaoFechar');
    render(<BotaoFechar empresaId={E} mes="2020-01" reabrir={false} podeFechar origem="ponto" semMarcacao="falta" />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar o mês' }));
    expect(screen.getByText(/horas apuradas pelo ponto/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar fechamento' }));
    await waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(calcular).toHaveBeenCalledWith(expect.anything(), [], expect.objectContaining({ origem: 'ponto', semMarcacao: 'falta' }));
  });
});
