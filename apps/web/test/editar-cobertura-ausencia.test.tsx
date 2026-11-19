// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const E = '11111111-1111-4111-8111-111111111111', D = '22222222-2222-4222-8222-222222222222', S = '33333333-3333-4333-8333-333333333333';
const atualizar = vi.fn(), resultado = vi.fn();
const revalidar = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidar(...a) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/contexto', () => ({
  exigirUsuario: async () => ({ user: { id: 'u' }, supabase: { from: () => ({ update: (...a: unknown[]) => { atualizar(...a); const c: Record<string, unknown> = {}; for (const m of ['eq', 'select']) c[m] = () => c; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok); return c; } }) } }),
}));

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
beforeEach(() => { atualizar.mockReset(); revalidar.mockReset(); resultado.mockReset().mockReturnValue({ data: [{ id: D }], error: null }); });
afterEach(cleanup);

describe('editarDemanda (ação)', () => {
  const dados = { empresaId: E, demandaId: D, dia: '2', inicio: '08:00', fim: '12:00', minimo: '3', ideal: '4', setorId: S };
  it('grava dia, faixa, mínimo, ideal e setor, e atualiza a lista e a tela da faixa', async () => {
    const { editarDemanda } = await import('@/app/(app)/empresas/[id]/escalas/cobertura/actions');
    expect(await editarDemanda({}, form(dados))).toEqual({ ok: 'Faixa salva.' });
    expect(atualizar).toHaveBeenCalledWith({ setor_id: S, dia_semana: 2, faixa_inicio_min: 480, faixa_fim_min: 720, minimo: 3, ideal: 4 });
    expect(revalidar).toHaveBeenCalledWith(`/empresas/${E}/escalas/cobertura`);
    expect(revalidar).toHaveBeenCalledWith(`/empresas/${E}/escalas/cobertura/${D}`);
  });
  it('saída 00:00 vale o fim do dia; setor em branco = empresa toda; ideal em branco = sem ideal', async () => {
    const { editarDemanda } = await import('@/app/(app)/empresas/[id]/escalas/cobertura/actions');
    await editarDemanda({}, form({ ...dados, fim: '00:00', setorId: '', ideal: '' }));
    expect(atualizar).toHaveBeenCalledWith({ setor_id: null, dia_semana: 2, faixa_inicio_min: 480, faixa_fim_min: 1440, minimo: 3, ideal: null });
  });
  it('recusa dados inválidos sem tocar no banco', async () => {
    const { editarDemanda } = await import('@/app/(app)/empresas/[id]/escalas/cobertura/actions');
    for (const [ruim, msg] of [[{ dia: '9' }, /inválido/], [{ demandaId: 'x' }, /inválido/], [{ fim: '08:00' }, /entrada e saída/], [{ inicio: '' }, /entrada e saída/], [{ minimo: '' }, /no mínimo/], [{ ideal: '1' }, /ideal/]] as const) {
      expect((await editarDemanda({}, form({ ...dados, ...ruim }))).erro, JSON.stringify(ruim)).toMatch(msg);
    }
    expect(atualizar).not.toHaveBeenCalled();
  });
  it('faixa que não existe (ou sem permissão) e erro do banco viram mensagens claras', async () => {
    const { editarDemanda } = await import('@/app/(app)/empresas/[id]/escalas/cobertura/actions');
    resultado.mockReturnValue({ data: [], error: null });
    expect((await editarDemanda({}, form(dados))).erro).toMatch(/não encontrada|sem permissão/);
    resultado.mockReturnValue({ data: null, error: { message: 'permission denied' } });
    expect((await editarDemanda({}, form(dados))).erro).toMatch(/permissão/);
    expect(revalidar).not.toHaveBeenCalled();
  });
});

describe('editarAusencia (ação)', () => {
  const dados = { empresaId: E, ausenciaId: D, tipo: 'ferias', inicio: '2026-12-01', fim: '2026-12-10', observacao: ' Fim de ano ' };
  it('grava tipo, período (fim inclusivo vira fim exclusivo) e observação, e atualiza a lista e a tela', async () => {
    const { editarAusencia } = await import('@/app/(app)/empresas/[id]/escalas/ausencias/actions');
    expect(await editarAusencia({}, form(dados))).toEqual({ ok: 'Lançamento salvo.' });
    expect(atualizar).toHaveBeenCalledWith({ tipo: 'ferias', periodo: '[2026-12-01,2026-12-11)', observacao: 'Fim de ano' });
    expect(revalidar).toHaveBeenCalledWith(`/empresas/${E}/escalas/ausencias/${D}`);
    await editarAusencia({}, form({ ...dados, tipo: 'afastamento', observacao: '' }));
    expect(atualizar).toHaveBeenLastCalledWith({ tipo: 'afastamento', periodo: '[2026-12-01,2026-12-11)', observacao: null });
  });
  it('recusa dados inválidos sem tocar no banco', async () => {
    const { editarAusencia } = await import('@/app/(app)/empresas/[id]/escalas/ausencias/actions');
    for (const [ruim, msg] of [[{ tipo: 'folga' }, /inválido/], [{ ausenciaId: 'x' }, /inválido/], [{ fim: '2026-11-30' }, /antes da inicial/], [{ inicio: '' }, /datas/]] as const) {
      expect((await editarAusencia({}, form({ ...dados, ...ruim }))).erro, JSON.stringify(ruim)).toMatch(msg);
    }
    expect(atualizar).not.toHaveBeenCalled();
  });
  it('sobreposição, permissão e lançamento inexistente viram mensagens claras', async () => {
    const { editarAusencia } = await import('@/app/(app)/empresas/[id]/escalas/ausencias/actions');
    resultado.mockReturnValue({ data: null, error: { message: 'conflicting key value violates exclusion constraint' } });
    expect((await editarAusencia({}, form(dados))).erro).toMatch(/se sobrepõem/);
    resultado.mockReturnValue({ data: null, error: { message: 'new row violates row-level security' } });
    expect((await editarAusencia({}, form(dados))).erro).toMatch(/permissão/);
    resultado.mockReturnValue({ data: [], error: null });
    expect((await editarAusencia({}, form(dados))).erro).toMatch(/não encontrado|sem permissão/);
  });
});

describe('formulários de edição', () => {
  it('faixa: abre com os valores atuais, inclusive o fim do dia como 00:00, e salva', async () => {
    const { FormEditarFaixa } = await import('@/app/(app)/empresas/[id]/escalas/cobertura/[demandaId]/FormEditarFaixa');
    render(<FormEditarFaixa empresaId={E} setores={[{ id: S, nome: 'Loja' }]} demanda={{ id: D, setor_id: S, dia_semana: 6, faixa_inicio_min: 480, faixa_fim_min: 1440, minimo: 2, ideal: 3 }} />);
    expect((screen.getByLabelText('Dia da semana') as HTMLSelectElement).value).toBe('6');
    expect((screen.getByLabelText(/^Setor/) as HTMLSelectElement).value).toBe(S);
    expect((screen.getByLabelText('Das') as HTMLInputElement).value).toBe('08:00');
    expect((screen.getByLabelText(/^Até/) as HTMLInputElement).value).toBe('00:00');
    expect((screen.getByLabelText('Mínimo de pessoas') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText(/^Ideal/) as HTMLInputElement).value).toBe('3');
    fireEvent.change(screen.getByLabelText('Mínimo de pessoas'), { target: { value: '3' } });   // ideal é 3: o mínimo não pode passar disso
    fireEvent.click(screen.getByRole('button', { name: 'Salvar faixa' }));
    await waitFor(() => expect(atualizar).toHaveBeenCalledWith(expect.objectContaining({ minimo: 3, ideal: 3, dia_semana: 6, faixa_fim_min: 1440, setor_id: S })));
    expect(await screen.findByText('Faixa salva.')).toBeTruthy();
    // mínimo acima do ideal: a mensagem da regra aparece e nada é gravado
    atualizar.mockClear();
    fireEvent.change(screen.getByLabelText('Mínimo de pessoas'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar faixa' }));
    expect(await screen.findByText('O número ideal não pode ser menor que o mínimo.')).toBeTruthy();
    expect(atualizar).not.toHaveBeenCalled();
  });
  it('ausência: abre com os valores atuais, salva e mostra o erro de sobreposição', async () => {
    const { FormEditarAusencia } = await import('@/app/(app)/empresas/[id]/escalas/ausencias/[ausenciaId]/FormEditarAusencia');
    render(<FormEditarAusencia empresaId={E} ausencia={{ id: D, tipo: 'afastamento', inicio: '2026-12-01', fim: '2026-12-10', observacao: 'Atestado' }} />);
    expect((screen.getByLabelText('Tipo') as HTMLSelectElement).value).toBe('afastamento');
    expect((screen.getByLabelText('Primeiro dia') as HTMLInputElement).value).toBe('2026-12-01');
    expect((screen.getByLabelText(/^Último dia/) as HTMLInputElement).value).toBe('2026-12-10');
    expect((screen.getByLabelText(/^Observação/) as HTMLInputElement).value).toBe('Atestado');
    fireEvent.change(screen.getByLabelText(/^Último dia/), { target: { value: '2026-12-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    await waitFor(() => expect(atualizar).toHaveBeenCalledWith({ tipo: 'afastamento', periodo: '[2026-12-01,2026-12-16)', observacao: 'Atestado' }));
    expect(await screen.findByText('Lançamento salvo.')).toBeTruthy();
    resultado.mockReturnValue({ data: null, error: { message: 'exclusion constraint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    expect(await screen.findByText(/se sobrepõem/)).toBeTruthy();
  });
});
