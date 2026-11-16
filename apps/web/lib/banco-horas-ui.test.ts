import { describe, expect, it } from 'vitest';
import { descreverLancamento, duracaoParaCampo, estornados, horasTexto, lerDuracao, saldoTexto } from './banco-horas-ui';

describe('banco de horas: apresentação', () => {
  it('formata horas e minutos', () => {
    expect(horasTexto(150)).toBe('2h30'); expect(horasTexto(60)).toBe('1h'); expect(horasTexto(45)).toBe('45min'); expect(horasTexto(125)).toBe('2h05');
    expect(horasTexto(-90)).toBe('−1h30'); expect(horasTexto(0)).toBe('0min');
    expect(saldoTexto(90)).toBe('+1h30'); expect(saldoTexto(-45)).toBe('−45min'); expect(saldoTexto(0)).toBe('0min');
  });
  it('lê a duração digitada', () => {
    expect(lerDuracao('02:30')).toBe(150); expect(lerDuracao('2:05')).toBe(125); expect(lerDuracao(' 24:00 ')).toBe(1440);
    for (const ruim of ['', '00:00', '24:01', '2h30', '12:75', 'abc', '-1:00']) expect(lerDuracao(ruim), ruim).toBeNull();
    expect(duracaoParaCampo(125)).toBe('02:05');
  });
  it('lista estornos e descreve lançamentos', () => {
    const base = { colaborador_id: 'a', data: '2027-02-01', descricao: null, criado_em: '' };
    const ls = [
      { ...base, id: 1, minutos: 120, origem: 'manual' as const, vence_em: '2027-08-01', estorna_id: null },
      { ...base, id: 2, minutos: -120, origem: 'estorno' as const, vence_em: null, estorna_id: 1 },
      { ...base, id: 3, minutos: -60, origem: 'compensacao' as const, vence_em: null, estorna_id: null },
    ];
    expect([...estornados(ls)]).toEqual([1]);
    expect(descreverLancamento(ls[0]!)).toBe('Crédito de 2h (vence em 01/08/2027)');
    expect(descreverLancamento(ls[2]!)).toBe('Compensação de 1h');
  });
});
