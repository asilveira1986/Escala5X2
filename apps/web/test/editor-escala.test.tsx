// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntradaEscala } from '@jc/servicos';
import { parseDaterange } from '@jc/rules-engine';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';

const salvarGrade = vi.fn(); const publicar = vi.fn(); const novaVersao = vi.fn(); const refresh = vi.fn(); const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/app/(app)/empresas/[id]/escalas/actions', () => ({ salvarGrade, publicar, novaVersao }));
vi.mock('../app/(app)/empresas/[id]/escalas/actions', () => ({ salvarGrade, publicar, novaVersao }));

const { EditorEscala } = await import('../app/(app)/empresas/[id]/escalas/[escalaId]/EditorEscala');

const entrada = (status: EntradaEscala['escala']['status'] = 'rascunho'): EntradaEscala => ({
  escala: { id: 'e1', empresaId: 'emp', setorId: null, nome: 'Semana teste', status, revisao: 3, versao: 1, inicio: '2027-01-04', fim: '2027-01-10' },
  regras: REGRAS_SEED,
  colaboradores: [{
    colaboradorId: 'ana', nome: 'Ana', setor: null, turno: null, empresa: { porte: 'medio', terceirizadaPublica: false, uf: 'SP', municipioIbge: '3550308' },
    escolaridade: null, salarioBaseCentavos: 300000, jornadaSemanalMin: 2400, divisorContrato: 200, tipoEscala: '5x2', folgasSemana: null,
    horasExtrasMensaisMin: 0, acordos: [], admissao: '2020-01-01', desligamento: null,
  }],
  semContrato: [], alocacoes: [], anteriores: [], ausencias: [], feriados: [{ data: '2027-01-05', nome: 'Feriado X', abrangencia: 'municipal' }], cobertura: [],
});
const manha = { id: 'm1', nome: 'Manhã', inicioMin: 480, fimMin: 1020, intervaloMin: 60, cor: '#2563eb' };
const cel = (dia: string) => screen.getByRole('button', { name: new RegExp(`^Ana, ${dia}/01/2027`) });

beforeEach(() => { salvarGrade.mockResolvedValue({ ok: true, revisao: 4 }); publicar.mockResolvedValue({ ok: true, hash: 'h' }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
void parseDaterange; void within;

describe('EditorEscala', () => {
  it('pinta a grade, valida ao vivo e só libera a publicação depois de salvar uma escala sem bloqueios', async () => {
    render(<EditorEscala empresaId="emp" entrada={entrada()} modelos={[manha]} />);
    expect((screen.getByRole('button', { name: 'Publicar' }) as HTMLButtonElement).disabled).toBe(true); // vazia
    for (const d of ['04', '05', '06', '07', '08']) fireEvent.click(cel(d));
    expect(cel('04').textContent).toBe('08:00');
    expect(screen.getByText(/Há alterações não salvas/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publicar' }) as HTMLButtonElement).disabled).toBe(true); // sujo
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(salvarGrade).toHaveBeenCalledTimes(1));
    expect(salvarGrade.mock.calls[0]![0]).toBe('e1');
    expect(salvarGrade.mock.calls[0]![1]).toBe(3);
    expect(salvarGrade.mock.calls[0]![2]).toHaveLength(5);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Publicar' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    fireEvent.click(screen.getByRole('checkbox')); // 05/01 é feriado: há um alerta a reconhecer
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar publicação' }));
    await waitFor(() => expect(publicar).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('sexto dia de trabalho gera bloqueio visível na célula e na lista, e impede publicar', () => {
    render(<EditorEscala empresaId="emp" entrada={entrada()} modelos={[manha]} />);
    for (const d of ['04', '05', '06', '07', '08', '09']) fireEvent.click(cel(d));
    expect(screen.getByText('Impedem a publicação').nextElementSibling!.textContent).not.toBe('0');
    expect(cel('09').getAttribute('aria-label')).toContain('Impede a publicação');
    expect(screen.getAllByText(/folga\(s\) na semana/).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Publicar' }) as HTMLButtonElement).disabled).toBe(true);
    // apagar o sexto dia resolve
    fireEvent.click(screen.getByRole('radio', { name: 'Apagar' }));
    fireEvent.click(cel('09'));
    expect(screen.getByText('Impedem a publicação').nextElementSibling!.textContent).toBe('0');
  });

  it('alerta exige o "li e quero publicar mesmo assim" antes de confirmar', async () => {
    const e = entrada();
    e.alocacoes = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08'].map((data) => ({ colaboradorId: 'ana', data, tipo: 'trabalho' as const, inicioMin: 480, fimMin: 1020, intervaloMin: 60 }));
    render(<EditorEscala empresaId="emp" entrada={e} modelos={[manha]} />); // 05/01 é feriado local: alerta
    expect(screen.getByText('Alertas').nextElementSibling!.textContent).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar publicação' });
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
  });

  it('mostra o erro do servidor quando salvar falha (ex.: outra pessoa alterou) e mantém o rascunho local', async () => {
    salvarGrade.mockResolvedValue({ ok: false, erro: 'A escala foi alterada por outra pessoa. Recarregue a página.' });
    render(<EditorEscala empresaId="emp" entrada={entrada()} modelos={[manha]} />);
    fireEvent.click(cel('04'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/alterada por outra pessoa/)).toBeTruthy();
    expect(cel('04').textContent).toBe('08:00');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('"Repetir 1ª semana" copia o padrão para as semanas seguintes', () => {
    const e = entrada(); e.escala.fim = '2027-01-17';
    render(<EditorEscala empresaId="emp" entrada={e} modelos={[manha]} />);
    fireEvent.click(cel('04'));
    fireEvent.click(screen.getByRole('button', { name: 'Repetir 1ª semana' }));
    expect(cel('11').textContent).toBe('08:00');
    expect(cel('12').textContent).toBe('');
  });

  it('escala publicada é somente leitura e oferece criar nova versão', async () => {
    novaVersao.mockResolvedValue({ ok: true, escalaId: 'e2' });
    const e = entrada('publicada');
    e.alocacoes = [{ colaboradorId: 'ana', data: '2027-01-04', tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 }];
    render(<EditorEscala empresaId="emp" entrada={e} modelos={[manha]} />);
    expect((cel('04') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Criar nova versão' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/empresas/emp/escalas/e2'));
  });

  it('mostra férias lançadas na grade, bloqueia trabalho nelas e destaca dia abaixo da cobertura mínima', () => {
    const e = entrada();
    e.ausencias = [{ colaboradorId: 'ana', inicio: '2027-01-06', fim: '2027-01-07', tipo: 'ferias' }];
    e.cobertura = [{ diaSemana: 1, faixaInicioMin: 480, faixaFimMin: 720, minimo: 1 }]; // segunda 08–12
    render(<EditorEscala empresaId="emp" entrada={e} modelos={[manha]} />);
    expect(cel('06').textContent).toBe('Fér');
    expect(cel('06').getAttribute('title')).toBe('Férias lançadas');
    expect(screen.getByTitle('Abaixo da cobertura mínima')).toBeTruthy(); // segunda 04/01 sem ninguém
    fireEvent.click(cel('04')); // cobre a segunda
    expect(screen.queryByTitle('Abaixo da cobertura mínima')).toBeNull();
    fireEvent.click(cel('06')); // trabalho em férias
    expect(cel('06').getAttribute('aria-label')).toContain('Impede a publicação');
    expect(screen.getAllByText(/férias/i).length).toBeGreaterThan(0);
  });
});
