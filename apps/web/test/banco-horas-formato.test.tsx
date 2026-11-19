// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Lancamento, SaldoBanco } from '@jc/servicos';
import { situacaoBanco } from '../lib/banco-horas-ui';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../app/(app)/empresas/[id]/banco-horas/actions', () => ({ lancar: vi.fn(), estornar: vi.fn() }));
const { TabelaBancoHoras } = await import('../app/(app)/empresas/[id]/banco-horas/TabelaBancoHoras');
const { TelaBancoHoras } = await import('../app/(app)/empresas/[id]/banco-horas/[colaboradorId]/TelaBancoHoras');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('situação do banco de horas', () => {
  it('prioriza vencido, depois saldo negativo, depois vence em breve; sem lançamento é à parte', () => {
    expect(situacaoBanco(null)).toBe('sem_lancamento');
    expect(situacaoBanco({ saldoMin: 600, aVencerMin: 120, vencidoMin: 60 })).toBe('vencido');
    expect(situacaoBanco({ saldoMin: -30, aVencerMin: 0, vencidoMin: 0 })).toBe('negativo');
    expect(situacaoBanco({ saldoMin: 600, aVencerMin: 120, vencidoMin: 0 })).toBe('a_vencer');
    expect(situacaoBanco({ saldoMin: 600, aVencerMin: 0, vencidoMin: 0 })).toBe('em_dia');
    expect(situacaoBanco({ saldoMin: 0, aVencerMin: 0, vencidoMin: 0 })).toBe('em_dia');
  });
});

describe('lista do banco de horas', () => {
  const dados = [
    { id: 'c1', nome: 'Ana Souza', saldoMin: 600, situacao: 'vencido' as const, valorCentavos: 12345 },
    { id: 'c2', nome: 'Bruno Lima', saldoMin: -90, situacao: 'negativo' as const, valorCentavos: 0 },
    { id: 'c3', nome: 'Caio Mendes', saldoMin: null, situacao: 'sem_lancamento' as const, valorCentavos: 0 },
  ];
  it('mostra pessoa, saldo e situação; vencido traz a estimativa; quem não tem lançamento mostra travessão', () => {
    render(<TabelaBancoHoras dados={dados} empresaId="emp" />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent).filter(Boolean)).toEqual(['Pessoa', 'Saldo', 'Situação']);
    expect(screen.getByText('+10h')).toBeTruthy();
    expect(screen.getByText('−1h30')).toBeTruthy();
    expect(screen.getByText('Vencido a pagar')).toBeTruthy();
    expect(screen.getByText(/≈ R\$\s?123,45/)).toBeTruthy();
    expect(screen.getByText('Saldo negativo')).toBeTruthy();
    expect(screen.getByText('Sem lançamentos')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });
  it('o nome é link e a linha leva à tela da pessoa', () => {
    render(<TabelaBancoHoras dados={dados} empresaId="emp" />);
    expect(screen.getByRole('link', { name: 'Caio Mendes' }).getAttribute('href')).toBe('/empresas/emp/banco-horas/c3');
    fireEvent.click(screen.getByText('Saldo negativo'));
    expect(push).toHaveBeenCalledWith('/empresas/emp/banco-horas/c2');
  });
});

describe('tela do banco de horas da pessoa', () => {
  const lanc = (extra: Partial<Lancamento>): Lancamento => ({ id: 1, colaborador_id: 'c1', data: '2026-10-01', minutos: 600, origem: 'manual', descricao: 'Sábado trabalhado', vence_em: '2026-11-10', estorna_id: null, criado_em: '2026-10-01T10:00:00Z', ...extra });
  const saldo: SaldoBanco = { saldoMin: 600, lotes: [{ venceEm: '2026-11-10', minutos: 480 }, { venceEm: '2026-12-20', minutos: 120 }], vencidoMin: 480, aVencerMin: 0, proximoVencimento: { venceEm: '2026-12-20', minutos: 120 }, negativoMin: 0 };
  const montar = (extra: Partial<Parameters<typeof TelaBancoHoras>[0]> = {}) => render(
    <TelaBancoHoras empresaId="emp" colaborador={{ id: 'c1', nome: 'Ana Souza' }} saldo={saldo} lancamentos={[lanc({})]} aba="extrato" podeGerir hoje="2026-11-19" {...extra} />);

  it('cabeçalho com a situação e resumo do saldo à vista', () => {
    montar();
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeTruthy();
    expect(screen.getByText('Vencido a pagar', { selector: 'span' })).toBeTruthy();
    const resumo = screen.getByLabelText('Resumo do banco de horas');
    expect(within(resumo).getByText('+10h')).toBeTruthy();
    expect(within(resumo).getByText('8h')).toBeTruthy();
    expect(within(resumo).getByText('20/12/2026 · 2h')).toBeTruthy();
  });
  it('abas por endereço, com a contagem de vencimentos; "Novo lançamento" só para a gestão', () => {
    montar();
    const links = within(screen.getByRole('navigation', { name: 'Seções do banco de horas' })).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Extrato', 'Vencimentos2', 'Novo lançamento']);
    expect(links[0]!.getAttribute('href')).toBe('/empresas/emp/banco-horas/c1');
    expect(links[2]!.getAttribute('href')).toBe('/empresas/emp/banco-horas/c1?aba=lancamento');
    cleanup();
    montar({ podeGerir: false });
    expect(within(screen.getByRole('navigation', { name: 'Seções do banco de horas' })).getAllByRole('link').map((l) => l.textContent)).toEqual(['Extrato', 'Vencimentos2']);
  });
  it('aba Extrato mostra o livro; sem lançamentos mostra o aviso', () => {
    montar();
    expect(screen.getByText('Sábado trabalhado')).toBeTruthy();
    cleanup();
    montar({ lancamentos: [] });
    expect(screen.getByText('Nenhum lançamento.')).toBeTruthy();
    expect(screen.getByText('Sem lançamentos')).toBeTruthy();
  });
  it('aba Vencimentos lista os lotes e marca o que já venceu', () => {
    montar({ aba: 'vencimentos' });
    expect(screen.getByText('10/11/2026')).toBeTruthy();
    expect(screen.getByText('20/12/2026', { selector: '.horario' })).toBeTruthy();
    expect(screen.getAllByText('Vencido')).toHaveLength(1);              // só o lote de 10/11 (hoje é 19/11)
    expect(screen.queryByRole('heading', { name: 'Extrato' })).toBeNull();   // o cartão do extrato não aparece nesta aba
  });
  it('aba Novo lançamento mostra o formulário; fora da gestão não aparece mesmo pelo endereço', () => {
    montar({ aba: 'lancamento' });
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeTruthy();
    cleanup();
    montar({ aba: 'lancamento', podeGerir: false });
    expect(screen.queryByRole('button', { name: 'Lançar' })).toBeNull();
  });
});
