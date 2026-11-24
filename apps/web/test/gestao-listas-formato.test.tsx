// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const { TabelaCarteira } = await import('../app/(app)/carteira/TabelaCarteira');
const { TabelaVersoes } = await import('../app/(app)/empresas/[id]/escalas/[escalaId]/historico/TabelaVersoes');
const { TabelaMudancas } = await import('../app/(app)/empresas/[id]/escalas/[escalaId]/historico/TabelaMudancas');

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const cabecalhos = () => screen.getAllByRole('columnheader').map((h) => h.textContent).filter(Boolean);

describe('carteira', () => {
  const dados = [
    { id: 'e1', razao: 'Padaria Estrela', cnpj: '11.222.333/0001-81', uf: 'SP', pessoas: 12, status: 'em_risco' as const,
      pendencias: [1, 2, 3].map((n) => ({ codigo: `p${n}`, texto: `Pendência ${n}`, href: `/empresas/e1/aba${n}` })) },
    { id: 'e2', razao: 'Mercado Central', cnpj: '45.723.174/0001-10', uf: 'MG', pessoas: 8, status: 'adequado' as const, pendencias: [] },
  ];
  it('mostra empresa, pessoas, pendências e situação; resume o excedente', () => {
    render(<TabelaCarteira dados={dados} />);
    expect(cabecalhos()).toEqual(['Empresa', 'Pessoas', 'Pendências', 'Situação']);
    expect(screen.getByText('Tudo em dia')).toBeTruthy();
    expect(screen.getByText('Pendência 2')).toBeTruthy();
    expect(screen.queryByText('Pendência 3')).toBeNull();
    expect(screen.getByText('+1 pendência')).toBeTruthy();
  });
  it('cada pendência leva à sua área sem abrir a empresa; a linha abre a empresa', () => {
    render(<TabelaCarteira dados={dados} />);
    const link = screen.getByRole('link', { name: 'Pendência 1' });
    expect(link.getAttribute('href')).toBe('/empresas/e1/aba1');
    fireEvent.click(link);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Em risco'));
    expect(push).toHaveBeenCalledWith('/empresas/e1');
  });
  it('a busca acha pelo CNPJ sem pontuação e pela UF', () => {
    render(<TabelaCarteira dados={dados} />);
    fireEvent.change(screen.getByLabelText('Buscar empresa'), { target: { value: '45723174' } });
    expect(screen.queryByText('Padaria Estrela')).toBeNull();
    fireEvent.change(screen.getByLabelText('Buscar empresa'), { target: { value: 'SP' } });
    expect(screen.getByText('Padaria Estrela')).toBeTruthy();
  });
});

describe('histórico de versões', () => {
  const versoes = [
    { id: 'v2', rotulo: 'Versão 2', status: 'publicada' as const, publicacao: '10/11/2026', hash: 'abc123', atual: true, hrefAbrir: '/x/v2', hrefComparar: null },
    { id: 'v1', rotulo: 'Versão 1', status: 'substituida' as const, publicacao: '01/11/2026', hash: 'zzz999', atual: false, hrefAbrir: '/x/v1', hrefComparar: '/x/h?aba=mudancas&de=v1' },
  ];
  it('lista versões com situação, abre ao clicar e compara sem abrir', () => {
    render(<TabelaVersoes dados={versoes} />);
    expect(cabecalhos()).toEqual(['Versão', 'Situação', 'Publicação']);
    expect(screen.getByText('esta')).toBeTruthy();
    const comparar = screen.getByRole('link', { name: 'Comparar com Versão 1' });
    expect(comparar.getAttribute('href')).toBe('/x/h?aba=mudancas&de=v1');
    fireEvent.click(comparar);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('01/11/2026'));
    expect(push).toHaveBeenCalledWith('/x/v1');
  });
  it('a busca acha pelo hash oculto', () => {
    render(<TabelaVersoes dados={versoes} />);
    fireEvent.change(screen.getByLabelText('Buscar versão'), { target: { value: 'zzz' } });
    expect(screen.queryByText('Versão 2')).toBeNull();
  });
  it('mudanças: dia, colaborador, antes e depois; busca por colaborador', () => {
    render(<TabelaMudancas dados={[
      { chave: '1', data: '03/11', pessoa: 'Ana', antes: 'Trabalho', depois: 'Folga' },
      { chave: '2', data: '04/11', pessoa: 'Beto', antes: 'Folga', depois: 'Trabalho' },
    ]} />);
    expect(cabecalhos()).toEqual(['Dia', 'Colaborador', 'Antes', 'Depois']);
    fireEvent.change(screen.getByLabelText('Buscar colaborador'), { target: { value: 'beto' } });
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('Beto')).toBeTruthy();
  });
});
