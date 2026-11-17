import { describe, expect, it } from 'vitest';
import dados from './cbo-dados.json';
import { buscarCbo, formatarCbo, type OcupacaoCbo } from './cbo';

const lista = dados as unknown as OcupacaoCbo[];
const cod = (q: string, n = 8) => buscarCbo(lista, q, n).map(([c]) => c);

describe('lista da CBO', () => {
  it('tem as ocupações da CBO 2002, com código no formato 0000-00 e sem repetição', () => {
    expect(lista.length).toBeGreaterThan(2400);
    expect(lista.every(([c, n]) => /^\d{4}-\d{2}$/.test(c) && n.length > 1)).toBe(true);
    expect(new Set(lista.map(([c]) => c)).size).toBe(lista.length);
    expect(lista.length).toBeGreaterThan(0);
  });
  it('traz ocupações comuns de RH com o código oficial', () => {
    const nome = (c: string) => lista.find(([x]) => x === c)?.[1];
    expect(nome('4110-10')).toBe('Assistente administrativo');
    expect(nome('5211-10')).toBe('Vendedor de comércio varejista');
    expect(nome('5143-20')).toBe('Faxineiro');
    expect(nome('2521-05')).toBe('Administrador');
  });
});

describe('buscarCbo', () => {
  it('por código, com ou sem hífen, começando pelo que foi digitado', () => {
    expect(cod('4110')).toContain('4110-10');
    expect(cod('411010')).toEqual(['4110-10']);
    expect(cod('4110-10')).toEqual(['4110-10']);
    expect(cod('4110').every((c) => c.startsWith('4110'))).toBe(true);
  });
  it('por nome, sem diferenciar acento ou maiúscula, e por várias palavras', () => {
    expect(cod('assistente administrativo')[0]).toBe('4110-10');
    expect(cod('ASSISTENTE ADMINISTRATIVO')[0]).toBe('4110-10');
    expect(buscarCbo(lista, 'vendedor comercio varejista').map(([, n]) => n)).toContain('Vendedor de comércio varejista');
    expect(buscarCbo(lista, 'padeiro').length).toBeGreaterThan(0);
  });
  it('quem começa com o texto vem antes de quem só contém', () => {
    const r = buscarCbo(lista, 'padeiro', 20).map(([, n]) => n.toLowerCase());
    const primeiroSoContem = r.findIndex((n) => !n.startsWith('padeiro'));
    const ultimoComeca = r.map((n) => n.startsWith('padeiro')).lastIndexOf(true);
    expect(r.some((n) => n.startsWith('padeiro'))).toBe(true);
    if (primeiroSoContem !== -1) expect(ultimoComeca).toBeLessThan(primeiroSoContem);
  });
  it('respeita o limite e devolve vazio sem consulta ou sem resultado', () => {
    expect(buscarCbo(lista, 'a', 5).length).toBe(5);
    expect(buscarCbo(lista, '')).toEqual([]);
    expect(buscarCbo(lista, '   ')).toEqual([]);
    expect(buscarCbo(lista, 'zzzzqqq')).toEqual([]);
    expect(buscarCbo(lista, '---')).toEqual([]);
  });
});

describe('formatarCbo', () => {
  it('aceita 6 dígitos com ou sem hífen e recusa o resto', () => {
    expect(formatarCbo('411010')).toBe('4110-10');
    expect(formatarCbo('4110-10')).toBe('4110-10');
    expect(formatarCbo('4110')).toBeNull();
    expect(formatarCbo('abc')).toBeNull();
    expect(formatarCbo('4110-1x')).toBeNull();
  });
});
