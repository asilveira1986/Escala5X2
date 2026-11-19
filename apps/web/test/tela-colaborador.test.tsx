// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../app/(app)/empresas/[id]/colaboradores/actions', () => ({
  atualizarDadosColaborador: vi.fn(), mudarContrato: vi.fn(), desligarColaborador: vi.fn(), reativarColaborador: vi.fn(), convidar: vi.fn(), revogarAcesso: vi.fn(),
}));
const { TelaColaborador } = await import('../app/(app)/empresas/[id]/colaboradores/[colaboradorId]/TelaColaborador');

afterEach(() => cleanup());
const contratos = [
  { id: 'k2', vigencia: '[2026-03-01,)', salario_base: 2000, jornada_semanal_min: 2640, divisor: 220, tipo_escala: '5x2', folgas_semana: null, turno: 'Manhã', horas_extras_mensais_min: 0 },
  { id: 'k1', vigencia: '[2026-01-05,2026-03-01)', salario_base: 1890, jornada_semanal_min: 2640, divisor: 220, tipo_escala: '5x2', folgas_semana: null, turno: null, horas_extras_mensais_min: 0 },
];
const montar = (extra: Partial<Parameters<typeof TelaColaborador>[0]> = {}) => render(
  <TelaColaborador empresaId="emp" colaboradorId="c1" aba="dados" acesso={{ estado: 'sem' }} hoje="2026-11-19" contratos={contratos} cpfMascarado="•••.•••.•••-00"
    colab={{ nome: 'Alex Teste', cargo: 'Repositor', setor: 'Loja', admissao: '2026-01-05', desligamento: null }}
    valoresPessoa={{ nome: 'Alex Teste', setor: 'Loja', matricula: '', cargo: 'Repositor', cbo: '', escolaridade: '', telefone: '' }}
    valoresContrato={{ salario: '2.000,00', jornada_semanal: '44', tipo_escala: '5x2', turno: 'Manhã', divisor: '220', folgas_semana: '', horas_extras_mensais: '' }} {...extra} />);

describe('tela do colaborador', () => {
  it('cabeçalho com nome, cargo, setor e situação; resumo do contrato atual sempre à vista', () => {
    montar();
    expect(screen.getByRole('heading', { name: 'Alex Teste' })).toBeTruthy();
    expect(screen.getByText(/Repositor · Loja · Admitido em 05\/01\/2026/)).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
    const resumo = screen.getByLabelText('Resumo do contrato atual');
    expect(within(resumo).getByText('5x2 · Manhã')).toBeTruthy();
    expect(within(resumo).getByText('44h')).toBeTruthy();
    expect(within(resumo).getByText(/2\.000,00/)).toBeTruthy();
    expect(within(resumo).getByText(/9,09/)).toBeTruthy();
  });

  it('abas por endereço: a primeira sem ?aba, a atual marcada', () => {
    montar({ aba: 'contrato' });
    const nav = screen.getByRole('navigation', { name: 'Seções do colaborador' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Dados pessoais', 'Contrato e escala', 'Acesso ao app', 'Desligamento']);
    expect(links[0]!.getAttribute('href')).toBe('/empresas/emp/colaboradores/c1');
    expect(links[2]!.getAttribute('href')).toBe('/empresas/emp/colaboradores/c1?aba=acesso');
    expect(links[1]!.getAttribute('aria-current')).toBe('page');
  });

  it('aba Dados pessoais: só o formulário de dados, em dois grupos', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Salvar dados' })).toBeTruthy();
    expect(screen.getByText('Identificação')).toBeTruthy();
    expect(screen.getByText('Trabalho')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar mudança de contrato' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desligar colaborador' })).toBeNull();
  });

  it('aba Contrato e escala: formulário de mudança e histórico com o contrato atual marcado', () => {
    montar({ aba: 'contrato' });
    expect(screen.getByRole('button', { name: 'Salvar mudança de contrato' })).toBeTruthy();
    expect(screen.getByText('Histórico de contratos')).toBeTruthy();
    expect(screen.getByText('desde 01/03/2026')).toBeTruthy();
    expect(screen.getByText('05/01/2026 a 28/02/2026')).toBeTruthy();
    expect(screen.getAllByText('Atual')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Salvar dados' })).toBeNull();
  });

  it('aba Acesso ao app: situação e convite', () => {
    montar({ aba: 'acesso' });
    expect(screen.getByText('Sem acesso')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Convidar Alex Teste' })).toBeTruthy();
  });

  it('aba Desligamento: desligar pede a data; desligado mostra a data e a situação', () => {
    montar({ aba: 'desligamento' });
    expect(screen.getByRole('button', { name: 'Desligar colaborador' })).toBeTruthy();
    cleanup();
    montar({ aba: 'desligamento', colab: { nome: 'Alex Teste', cargo: null, setor: null, admissao: '2026-01-05', desligamento: '2026-10-31' } });
    expect(screen.getByText('Desligado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reativar colaborador' })).toBeTruthy();
    expect(screen.queryByText('Atual')).toBeNull();
  });
});
