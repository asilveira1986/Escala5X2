// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Diagnostico } from '@jc/rules-engine';
import { situacaoDiagnostico } from '../lib/diagnostico-ui';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const { TabelaEmpresas } = await import('../app/(app)/empresas/TabelaEmpresas');
const { VisaoGeral } = await import('../components/VisaoGeral');
const { TabelaDiagnosticos } = await import('../app/(app)/empresas/[id]/diagnostico/TabelaDiagnosticos');
const { CabecalhoDiagnostico } = await import('../app/(app)/empresas/[id]/diagnostico/[diagId]/CabecalhoDiagnostico');

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const cabecalhos = () => screen.getAllByRole('columnheader').map((h) => h.textContent).filter(Boolean);

describe('lista de empresas', () => {
  const dados = [
    { id: 'e1', razao_social: 'Padaria Estrela Ltda', cnpj: '11222333000181', porte: 'me' as const, uf: 'SP', status_adequacao: 'em_risco' as const },
    { id: 'e2', razao_social: 'Mercado Central', cnpj: '45723174000110', porte: 'medio' as const, uf: 'MG', status_adequacao: 'adequado' as const },
  ];
  it('mostra empresa, CNPJ e situação; porte e UF não aparecem na lista', () => {
    render(<TabelaEmpresas dados={dados} />);
    expect(cabecalhos()).toEqual(['Empresa', 'CNPJ', 'Situação']);
    expect(screen.getByText('11.222.333/0001-81')).toBeTruthy();
    expect(screen.getByText('Em risco')).toBeTruthy();
    expect(screen.getByText('Adequado')).toBeTruthy();
    expect(screen.queryByText('Microempresa')).toBeNull();
  });
  it('o nome é link para a empresa e a linha leva a ela', () => {
    render(<TabelaEmpresas dados={dados} />);
    expect(screen.getByRole('link', { name: 'Mercado Central' }).getAttribute('href')).toBe('/empresas/e2');
    fireEvent.click(screen.getByText('Em risco'));
    expect(push).toHaveBeenCalledWith('/empresas/e1');
  });
  it('a busca acha pela UF e pelo porte, mesmo ocultos; vazio orienta o próximo passo', () => {
    render(<TabelaEmpresas dados={dados} />);
    fireEvent.change(screen.getByLabelText('Buscar empresa'), { target: { value: 'MG' } });
    expect(screen.queryByText('Padaria Estrela Ltda')).toBeNull();
    expect(screen.getByText('Mercado Central')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar empresa'), { target: { value: 'micro' } });
    expect(screen.getByText('Padaria Estrela Ltda')).toBeTruthy();
    cleanup();
    render(<TabelaEmpresas dados={[]} />);
    expect(screen.getByText(/Use o botão Nova empresa/)).toBeTruthy();
  });
});

describe('visão geral da empresa', () => {
  it('cabeçalho no formato dos itens: nome, CNPJ, porte, UF e situação; as métricas continuam', () => {
    render(<VisaoGeral empresaId="e1" empresa={{ razao_social: 'Padaria Estrela Ltda', cnpj: '11222333000181', porte: 'me', uf: 'SP', status_adequacao: 'em_risco' }}
      resumo={{ colab: 24, turnos: 3, publicadas: 2, rascunhos: 1, pendentes: 4 }} />);
    expect(screen.getByRole('heading', { name: 'Padaria Estrela Ltda' })).toBeTruthy();
    expect(screen.getByText('CNPJ 11.222.333/0001-81 · Microempresa · SP')).toBeTruthy();
    expect(screen.getByText('Em risco')).toBeTruthy();
    expect(screen.getByText('Colaboradores ativos')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
  });
});

describe('situação do diagnóstico', () => {
  it('sem resumo, tudo adequado ou quantas pessoas a adequar', () => {
    expect(situacaoDiagnostico(null)).toEqual({ tom: 'cinza', rotulo: 'Sem resumo' });
    expect(situacaoDiagnostico(0)).toEqual({ tom: 'verde', rotulo: 'Tudo adequado' });
    expect(situacaoDiagnostico(7)).toEqual({ tom: 'amarelo', rotulo: '7 a adequar' });
  });
});

describe('lista de diagnósticos', () => {
  const dados = [
    { id: 'd1', referencia: '01/12/2026', pessoas: 24, aAdequar: 9, geradoEm: '19/11/2026' },
    { id: 'd2', referencia: '01/06/2026', pessoas: 22, aAdequar: 0, geradoEm: '10/06/2026' },
    { id: 'd3', referencia: '01/01/2026', pessoas: null, aAdequar: null, geradoEm: '05/01/2026' },
  ];
  it('mostra referência, pessoas e situação; a linha leva ao diagnóstico', () => {
    render(<TabelaDiagnosticos dados={dados} empresaId="emp" />);
    expect(cabecalhos()).toEqual(['Referência', 'Pessoas', 'Situação']);
    expect(screen.getByText('9 a adequar')).toBeTruthy();
    expect(screen.getByText('Tudo adequado')).toBeTruthy();
    expect(screen.getByText('Sem resumo')).toBeTruthy();
    expect(screen.queryByText('19/11/2026')).toBeNull();
    expect(screen.getByRole('link', { name: '01/06/2026' }).getAttribute('href')).toBe('/empresas/emp/diagnostico/d2');
    fireEvent.click(screen.getByText('9 a adequar'));
    expect(push).toHaveBeenCalledWith('/empresas/emp/diagnostico/d1');
  });
  it('a busca acha pela data de geração, mesmo oculta; vazio orienta', () => {
    render(<TabelaDiagnosticos dados={dados} empresaId="emp" />);
    fireEvent.change(screen.getByLabelText('Buscar diagnóstico'), { target: { value: '10/06/2026' } });
    expect(screen.queryByText('01/12/2026')).toBeNull();
    expect(screen.getByText('01/06/2026')).toBeTruthy();
    cleanup();
    render(<TabelaDiagnosticos dados={[]} empresaId="emp" />);
    expect(screen.getByText(/Use o botão Novo diagnóstico/)).toBeTruthy();
  });
});

describe('cabeçalho do diagnóstico', () => {
  const diag = {
    dataReferencia: '2026-12-01',
    resumo: { total: 24, porClassificacao: { adequado: 15, adequacao_f1: 6, adequacao_f2: 3, excecao: 0 }, folhaMensalCentavos: 6_500_000, horasPerdidasF1Min: 1200, horasPerdidasF2Min: 2400 },
  } as unknown as Diagnostico;
  it('referência, geração, situação, downloads e resumo dos números principais', () => {
    render(<CabecalhoDiagnostico diagnostico={diag} criadoEm="2026-11-19T10:00:00Z" baixarEm="/api/v1/diagnosticos/d1/relatorio" />);
    expect(screen.getByRole('heading', { name: 'Diagnóstico de 01/12/2026' })).toBeTruthy();
    expect(screen.getByText('Gerado em 19/11/2026 · 24 pessoas analisadas')).toBeTruthy();
    expect(screen.getByText('9 a adequar', { selector: 'span' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Baixar PDF/ }).getAttribute('href')).toBe('/api/v1/diagnosticos/d1/relatorio?formato=pdf');
    expect(screen.getByRole('link', { name: /Baixar planilha/ }).getAttribute('href')).toBe('/api/v1/diagnosticos/d1/relatorio?formato=xlsx');
    const resumo = screen.getByLabelText('Resumo do diagnóstico');
    expect(within(resumo).getByText('24')).toBeTruthy();
    expect(within(resumo).getByText('9')).toBeTruthy();
    expect(within(resumo).getByText('40h')).toBeTruthy();
    expect(within(resumo).getByText(/65\.000,00/)).toBeTruthy();
  });
});
