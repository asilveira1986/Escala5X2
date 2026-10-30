import { describe, expect, it } from 'vitest';
import { dataDeInstante, parseDaterange, somarDias, vigenciaContem } from '../src';

describe('datas', () => {
  it('converte instante para data civil de São Paulo (virada de dia)', () => {
    expect(dataDeInstante(new Date('2026-12-15T02:30:00Z'))).toBe('2026-12-14'); // 23:30 em SP
    expect(dataDeInstante(new Date('2026-12-15T03:00:00Z'))).toBe('2026-12-15'); // 00:00 em SP
  });
  it.each([
    ['[2026-12-15,2027-12-15)', '2026-12-15', '2027-12-15'],
    ['[2027-12-15,)', '2027-12-15', null],
    ['(2026-12-14,2027-12-14]', '2026-12-15', '2027-12-15'],
  ])('parseDaterange %s', (txt, ini, fim) => {
    expect(parseDaterange(txt)).toEqual({ inicio: ini, fim });
  });
  it('vigência tem início inclusivo e fim exclusivo', () => {
    const v = parseDaterange('[2026-12-15,2027-12-15)');
    expect(vigenciaContem(v, '2026-12-14')).toBe(false);
    expect(vigenciaContem(v, '2026-12-15')).toBe(true);
    expect(vigenciaContem(v, '2027-12-14')).toBe(true);
    expect(vigenciaContem(v, '2027-12-15')).toBe(false);
  });
  it('somarDias atravessa mês e ano bissexto', () => {
    expect(somarDias('2027-12-31', 1)).toBe('2028-01-01');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDias('2026-12-15', -1)).toBe('2026-12-14');
  });
  it('rejeita data inválida', () => {
    expect(() => somarDias('2026-13-01', 1)).toThrow();
    expect(() => somarDias('15/12/2026', 1)).toThrow();
  });
});
