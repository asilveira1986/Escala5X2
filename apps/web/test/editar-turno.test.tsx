// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const E = '11111111-1111-4111-8111-111111111111', T = '22222222-2222-4222-8222-222222222222';
const atualizar = vi.fn(), resultado = vi.fn(), push = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@jc/jobs', () => ({ enfileirarOtimizacaoAvulsa: vi.fn() }));
vi.mock('@/lib/supabase/servidor-restrito', () => ({ supabaseServidorRestrito: () => null }));
vi.mock('@/lib/contexto', () => ({
  exigirUsuario: async () => ({ user: { id: 'u' }, supabase: { from: () => ({ update: (...a: unknown[]) => { atualizar(...a); const c: Record<string, unknown> = {}; for (const m of ['eq', 'select']) c[m] = () => c; (c as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok); return c; } }) } }),
}));

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const dados = { empresaId: E, modeloId: T, nome: ' Manhã ', inicio: '07:00', fim: '16:00', intervalo: '60' };
beforeEach(() => { push.mockReset(); atualizar.mockReset(); resultado.mockReset().mockReturnValue({ data: [{ id: T }], error: null }); });
afterEach(cleanup);

describe('editarModelo / arquivarModelo (ações)', () => {
  it('edita nome, horários e intervalo (saída antes da entrada = dia seguinte) e confere a empresa', async () => {
    const { editarModelo } = await import('@/app/(app)/empresas/[id]/escalas/actions');
    expect(await editarModelo({}, form(dados))).toEqual({ ok: true });
    expect(atualizar).toHaveBeenCalledWith({ nome: 'Manhã', inicio_min: 420, fim_min: 960, intervalo_min: 60 });
    expect(await editarModelo({}, form({ ...dados, nome: 'Noite', inicio: '22:00', fim: '06:00' }))).toEqual({ ok: true });
    expect(atualizar).toHaveBeenLastCalledWith({ nome: 'Noite', inicio_min: 1320, fim_min: 1800, intervalo_min: 60 });
  });
  it('recusa dados inválidos sem tocar no banco', async () => {
    const { editarModelo } = await import('@/app/(app)/empresas/[id]/escalas/actions');
    for (const ruim of [{ nome: '' }, { inicio: '25:00' }, { intervalo: '999' }, { fim: '07:30', intervalo: '90' }, { modeloId: 'x' }]) expect(await editarModelo({}, form({ ...dados, ...ruim })), JSON.stringify(ruim)).toHaveProperty('erro');
    expect(atualizar).not.toHaveBeenCalled();
  });
  it('mensagens claras: nome repetido, sem permissão e turno que não existe', async () => {
    const { editarModelo } = await import('@/app/(app)/empresas/[id]/escalas/actions');
    resultado.mockReturnValue({ data: null, error: { message: 'duplicate key value violates unique constraint' } });
    expect(await editarModelo({}, form(dados))).toEqual({ erro: 'Já existe um turno com esse nome.' });
    resultado.mockReturnValue({ data: null, error: { message: 'new row violates row-level security' } });
    expect((await editarModelo({}, form(dados))).erro).toMatch(/permissão/);
    resultado.mockReturnValue({ data: [], error: null });
    expect((await editarModelo({}, form(dados))).erro).toMatch(/não encontrado|sem permissão/);
  });
  it('remover = arquivar (ativo=false), não apagar', async () => {
    const { arquivarModelo } = await import('@/app/(app)/empresas/[id]/escalas/actions');
    expect(await arquivarModelo(E, T)).toEqual({ ok: true });
    expect(atualizar).toHaveBeenCalledWith({ ativo: false });
    expect(await arquivarModelo('x', T)).toEqual({ ok: false, erro: 'Pedido inválido.' });
    resultado.mockReturnValue({ data: [], error: null });
    expect(await arquivarModelo(E, T)).toMatchObject({ ok: false });
  });
});

const turno = { id: T, nome: 'Manhã', inicio_min: 480, fim_min: 1020, intervalo_min: 60 };
vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({ push }) }));

describe('tela do turno', () => {
  const montar = async (t = turno) => {
    const { TelaTurno } = await import('@/app/(app)/empresas/[id]/escalas/turnos/[turnoId]/TelaTurno');
    return render(<TelaTurno empresaId={E} turno={t} />);
  };
  it('cabeçalho e resumo mostram horário, intervalo e jornada líquida', async () => {
    await montar();
    expect(screen.getByRole('heading', { name: 'Manhã' })).toBeTruthy();
    expect(screen.getByText('Turno de 08:00–17:00')).toBeTruthy();
    const resumo = screen.getByLabelText('Resumo do turno');
    expect(resumo.textContent).toContain('08:00');
    expect(resumo.textContent).toContain('17:00');
    expect(resumo.textContent).toContain('60 min');
    expect(resumo.textContent).toContain('8h');
  });
  it('o formulário abre com os valores atuais e salva', async () => {
    await montar();
    expect((screen.getByLabelText('Entrada') as HTMLInputElement).value).toBe('08:00');
    expect((screen.getByLabelText(/^Saída/) as HTMLInputElement).value).toBe('17:00');
    expect((screen.getByLabelText('Intervalo (min)') as HTMLInputElement).value).toBe('60');
    expect(screen.getByText(/A mudança vale para as próximas/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Entrada'), { target: { value: '07:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar turno' }));
    await waitFor(() => expect(atualizar).toHaveBeenCalledWith(expect.objectContaining({ inicio_min: 450 })));
    expect(await screen.findByText('Turno salvo.')).toBeTruthy();
  });
  it('turno noturno: saída do dia seguinte aparece como está', async () => {
    await montar({ id: T, nome: 'Noite', inicio_min: 1320, fim_min: 1800, intervalo_min: 60 });
    expect(screen.getByText('Turno de 22:00–06:00')).toBeTruthy();
    expect((screen.getByLabelText(/^Saída/) as HTMLInputElement).value).toBe('06:00');
  });
  it('remover pede confirmação, arquiva e volta para a lista', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Remover turno' }));
    expect(atualizar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await waitFor(() => expect(atualizar).toHaveBeenCalledWith({ ativo: false }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/empresas/${E}/escalas/turnos`));
  });
  it('cancelar a remoção não arquiva; erro ao remover aparece na tela', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Remover turno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(atualizar).not.toHaveBeenCalled();
    resultado.mockReturnValue({ data: null, error: { message: 'permission denied' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remover turno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    expect(await screen.findByText(/permissão/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
