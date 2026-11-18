// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Abas } from '@/components/Abas';
import { hrefDaAba, lerAba } from '@/lib/abas';

afterEach(cleanup);
const abas = [{ id: 'conferencia', rotulo: 'Conferência' }, { id: 'importar', rotulo: 'Importar', contagem: 3 }, { id: 'historico', rotulo: 'Histórico' }];

describe('abas por endereço', () => {
  it('lê a aba da URL; valor ausente, desconhecido ou estranho vira a primeira', () => {
    expect(lerAba('importar', abas)).toBe('importar');
    for (const v of [undefined, '', 'x', ['importar'], 5, null]) expect(lerAba(v, abas)).toBe('conferencia');
  });
  it('monta o endereço mantendo os outros parâmetros; a primeira aba fica sem ?aba', () => {
    expect(hrefDaAba('/p', abas, 'conferencia')).toBe('/p');
    expect(hrefDaAba('/p', abas, 'importar')).toBe('/p?aba=importar');
    expect(hrefDaAba('/p', abas, 'conferencia', { mes: '2027-03' })).toBe('/p?mes=2027-03');
    expect(hrefDaAba('/p', abas, 'historico', { mes: '2027-03', x: undefined })).toBe('/p?mes=2027-03&aba=historico');
  });
  it('marca a aba atual e mostra a contagem só quando há pendência', () => {
    render(<Abas abas={abas} atual="importar" base="/p" extras={{ mes: '2027-03' }} />);
    const atual = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(atual.map((l) => l.textContent)).toEqual(['Importar3']);
    expect(screen.getByRole('link', { name: 'Conferência' }).getAttribute('href')).toBe('/p?mes=2027-03');
    expect(screen.getByRole('link', { name: /Histórico/ }).getAttribute('href')).toBe('/p?mes=2027-03&aba=historico');
  });
});
