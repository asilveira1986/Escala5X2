// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/(app)/empresas/[id]/colaboradores/actions', () => ({ convidar: vi.fn(), revogarAcesso: vi.fn() }));
const { TabelaColaboradores } = await import('../app/(app)/empresas/[id]/colaboradores/TabelaColaboradores');

afterEach(() => cleanup());
const base = { matricula: null, turno: null, hipersuficiente: false, divisor: 220, jornada_semanal_min: 2640, tipo_escala: '5x2', salario_base: 1890 };
const dados = [
  { ...base, colaborador_id: 'c1', nome: 'Ana Souza', cargo: 'Repositora', setor_nome: 'Loja', acesso: { estado: 'sem' as const } },
  { ...base, colaborador_id: 'c2', nome: 'Bruno Lima', cargo: 'Caixa', setor_nome: null, hipersuficiente: true, matricula: '123', acesso: { estado: 'com' as const } },
];
const montar = (podeGerir = true) => render(<TabelaColaboradores dados={dados} empresaId="emp" podeGerir={podeGerir} />);

describe('lista de colaboradores', () => {
  it('mostra só nome, setor e status; o resto não aparece na lista', () => {
    montar();
    const cab = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(cab).toEqual(['Nome', 'Setor', 'Status']);
    expect(screen.getByText('Sem acesso')).toBeTruthy();
    expect(screen.getByText('Com acesso')).toBeTruthy();
    expect(screen.queryByText('Repositora')).toBeNull();
    expect(screen.queryByText(/1\.890/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicar na linha abre o painel com o restante; Esc fecha', () => {
    montar();
    fireEvent.click(screen.getByText('Bruno Lima'));
    const painel = screen.getByRole('dialog');
    expect(within(painel).getByRole('heading', { name: 'Bruno Lima' })).toBeTruthy();
    expect(within(painel).getByText(/Caixa/)).toBeTruthy();
    expect(within(painel).getByText('5x2')).toBeTruthy();
    expect(within(painel).getByText('44h')).toBeTruthy();
    expect(within(painel).getByText(/1\.890,00/)).toBeTruthy();
    expect(within(painel).getByText('Alta renda')).toBeTruthy();
    expect(within(painel).getByText('Com acesso')).toBeTruthy();
    expect(within(painel).getByRole('link', { name: 'Editar cadastro' }).getAttribute('href')).toBe('/empresas/emp/colaboradores/c2');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('quem não gere não vê o link de edição; "Fechar" e o fundo também fecham', () => {
    montar(false);
    fireEvent.click(screen.getByText('Ana Souza'));
    const painel = screen.getByRole('dialog');
    expect(within(painel).queryByRole('link', { name: 'Editar cadastro' })).toBeNull();
    expect(within(painel).queryByRole('button', { name: /Convidar/ })).toBeNull();
    fireEvent.click(within(painel).getAllByRole('button', { name: 'Fechar' })[1]!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a busca continua achando pelo cargo, mesmo oculto', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Buscar colaborador'), { target: { value: 'caixa' } });
    expect(screen.queryByText('Ana Souza')).toBeNull();
    expect(screen.getByText('Bruno Lima')).toBeTruthy();
  });
});
