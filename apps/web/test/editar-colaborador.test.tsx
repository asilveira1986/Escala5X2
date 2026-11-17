// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const E = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222';
const rpc = vi.fn(); const refresh = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({ refresh }) }));
vi.mock('@/lib/contexto', () => ({ exigirUsuario: async () => ({ supabase: { rpc }, user: { id: 'u' } }) }));
vi.mock('@/lib/supabase/envio-link', () => ({ enviarLinkDeAcesso: vi.fn() }));

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const acoes = () => import('@/app/(app)/empresas/[id]/colaboradores/actions');
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: null, error: null }); refresh.mockClear(); });
afterEach(cleanup);

describe('atualizarDadosColaborador', () => {
  const ok = { nome: 'Ana Paula', setor: 'Padaria', matricula: 'M1', cargo: 'Padeira', cbo: '8483-05', escolaridade: 'medio', telefone: '(11) 98888-7777' };
  it('normaliza e grava pela função do banco', async () => {
    const r = await (await acoes()).atualizarDadosColaborador(E, C, {}, form(ok));
    expect(r.ok).toBe('Dados salvos.');
    expect(rpc).toHaveBeenCalledWith('atualizar_colaborador', expect.objectContaining({ p_colaborador: C, p_nome: 'Ana Paula', p_cbo: '848305', p_telefone: '11988887777', p_escolaridade: 'medio', p_setor_nome: 'Padaria' }));
  });
  it('mostra o erro de cada campo e não chama o banco', async () => {
    const r = await (await acoes()).atualizarDadosColaborador(E, C, {}, form({ ...ok, nome: 'A', cbo: '999999', telefone: '123' }));
    expect(Object.keys(r.erros!).sort()).toEqual(['cbo', 'nome', 'telefone']);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('campos vazios viram nulo (limpa matrícula, cargo e telefone)', async () => {
    await (await acoes()).atualizarDadosColaborador(E, C, {}, form({ ...ok, matricula: '', cargo: '', cbo: '', telefone: '', escolaridade: '' }));
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_matricula: null, p_cargo: null, p_cbo: null, p_telefone: null, p_escolaridade: null });
  });
});

describe('mudarContrato', () => {
  const ok = { a_partir_de: '2026-06-01', salario: '2.500,50', jornada_semanal: '44:00', tipo_escala: '5x2', turno: 'Manhã', divisor: '', folgas_semana: '', horas_extras_mensais: '' };
  it('valida como a importação e envia a data de vigência', async () => {
    const r = await (await acoes()).mudarContrato(E, C, {}, form(ok));
    expect(r.ok).toMatch(/Contrato atualizado/);
    expect(rpc).toHaveBeenCalledWith('alterar_contrato', expect.objectContaining({ p_colaborador: C, p_a_partir_de: '2026-06-01', p_salario: 2500.5, p_jornada_min: 2640, p_divisor: 220, p_tipo_escala: '5x2', p_turno: 'Manhã' }));
  });
  it('erros por campo (salário, escala, data) sem chamar o banco', async () => {
    const r = await (await acoes()).mudarContrato(E, C, {}, form({ ...ok, salario: '0', tipo_escala: 'xx', a_partir_de: '31/02/2026' }));
    expect(Object.keys(r.erros!).sort()).toEqual(['a_partir_de', 'salario', 'tipo_escala']);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('erro de data vindo do banco aparece no campo da data', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'A data é anterior ao início do contrato atual (2026-05-01)' } });
    const r = await (await acoes()).mudarContrato(E, C, {}, form(ok));
    expect(r.erros?.a_partir_de).toMatch(/anterior ao início/);
  });
});

describe('desligar e reativar (ações)', () => {
  it('desligar avisa quando ainda há dias em escala', async () => {
    rpc.mockResolvedValue({ data: { dias_em_escala: 3 }, error: null });
    const r = await (await acoes()).desligarColaborador(E, C, '2026-08-31');
    expect(r).toMatchObject({ ok: true });
    expect((r as { mensagem: string }).mensagem).toMatch(/3 dia\(s\) de trabalho/);
    expect(rpc).toHaveBeenCalledWith('desligar_colaborador', { p_colaborador: C, p_data: '2026-08-31' });
  });
  it('data inválida não chega ao banco; erro do banco é devolvido', async () => {
    expect(await (await acoes()).desligarColaborador(E, C, '2026-13-40')).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: 'Colaborador já desligado' } });
    expect(await (await acoes()).desligarColaborador(E, C, '2026-08-31')).toEqual({ ok: false, erro: 'Colaborador já desligado' });
  });
  it('reativar chama a função do banco', async () => {
    expect(await (await acoes()).reativarColaborador(E, C)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith('reativar_colaborador', { p_colaborador: C });
  });
});

describe('PainelDesligamento', () => {
  const montar = async (desligamento: string | null) => {
    const { PainelDesligamento } = await import('@/app/(app)/empresas/[id]/colaboradores/[colaboradorId]/PainelDesligamento');
    return render(<PainelDesligamento empresaId={E} colaboradorId={C} nome="Ana" desligamento={desligamento} hoje="2026-08-31" admissao="2026-01-05" />);
  };
  it('pede confirmação antes de desligar e só então chama o banco', async () => {
    await montar(null);
    fireEvent.click(screen.getByRole('button', { name: 'Desligar colaborador' }));
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/31\/08\/2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desligamento' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith('desligar_colaborador', { p_colaborador: C, p_data: '2026-08-31' });
  });
  it('cancelar não desliga', async () => {
    await montar(null);
    fireEvent.click(screen.getByRole('button', { name: 'Desligar colaborador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('desligado mostra a data e oferece reativar', async () => {
    await montar('2026-08-31');
    expect(screen.getByText('31/08/2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reativar colaborador' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('reativar_colaborador', { p_colaborador: C }));
  });
});
