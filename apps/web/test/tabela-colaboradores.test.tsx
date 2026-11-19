// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const { TabelaColaboradores } = await import('../app/(app)/empresas/[id]/colaboradores/TabelaColaboradores');

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const base = { matricula: null, turno: null, hipersuficiente: false, divisor: 220, jornada_semanal_min: 2640, tipo_escala: '5x2', salario_base: 1890 };
const dados = [
  { ...base, colaborador_id: 'c1', nome: 'Ana Souza', cargo: 'Repositora', setor_nome: 'Loja', acesso: { estado: 'sem' as const } },
  { ...base, colaborador_id: 'c2', nome: 'Bruno Lima', cargo: 'Caixa', setor_nome: null, matricula: '123', acesso: { estado: 'com' as const } },
];
const montar = (podeGerir = true) => render(<TabelaColaboradores dados={dados} empresaId="emp" podeGerir={podeGerir} />);

describe('lista de colaboradores', () => {
  it('mostra só nome, setor e status', () => {
    montar();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent).filter(Boolean)).toEqual(['Nome', 'Setor', 'Status']);
    expect(screen.getByText('Sem acesso')).toBeTruthy();
    expect(screen.getByText('Com acesso')).toBeTruthy();
    expect(screen.queryByText('Repositora')).toBeNull();
    expect(screen.queryByText(/1\.890/)).toBeNull();
  });

  it('o nome é um link para a tela do colaborador e clicar na linha também leva até ela', () => {
    montar();
    expect(screen.getByRole('link', { name: 'Bruno Lima' }).getAttribute('href')).toBe('/empresas/emp/colaboradores/c2');
    fireEvent.click(screen.getByText('Com acesso'));
    expect(push).toHaveBeenCalledWith('/empresas/emp/colaboradores/c2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('quem não gere vê a lista sem links e sem clique na linha', () => {
    montar(false);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByText('Ana Souza'));
    expect(push).not.toHaveBeenCalled();
  });

  it('a busca acha pelo cargo, mesmo oculto', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Buscar colaborador'), { target: { value: 'caixa' } });
    expect(screen.queryByText('Ana Souza')).toBeNull();
    expect(screen.getByText('Bruno Lima')).toBeTruthy();
  });
});
