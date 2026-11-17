import { describe, expect, it } from 'vitest';
import { balancoDaEquipe, horaDeMinutos, horasTexto, inicialDoTurno, liquidoDoTurno, minutosDeHora, sugerirCobertura } from '@/lib/adequador-ui';

describe('adequador-ui', () => {
  it('horários: converte e recusa o inválido', () => {
    expect(minutosDeHora('08:30')).toBe(510);
    for (const ruim of ['24:00', '8:30', '08:60', '', 'abc']) expect(minutosDeHora(ruim), ruim).toBeNull();
    expect(horaDeMinutos(510)).toBe('08:30');
    expect(horaDeMinutos(1500)).toBe('01:00');
  });
  it('horas líquidas, inclusive turno que vira a noite e intervalo maior que o turno', () => {
    expect(liquidoDoTurno({ inicio: '08:00', fim: '17:00', intervalo: 60 })).toBe(480);
    expect(liquidoDoTurno({ inicio: '22:00', fim: '06:00', intervalo: 60 })).toBe(420);
    expect(liquidoDoTurno({ inicio: '08:00', fim: '08:30', intervalo: 60 })).toBeNull();
    expect(liquidoDoTurno({ inicio: 'x', fim: '17:00', intervalo: 0 })).toBeNull();
    expect([horasTexto(480), horasTexto(450), horasTexto(2400)]).toEqual(['8h', '7h30', '40h']);
  });
  it('balanço: posições por semana, capacidade e pessoas necessárias', () => {
    const t = [{ minimo: Array(7).fill(5) }, { minimo: Array(7).fill(5) }];
    expect(balancoDaEquipe(t, 14, 5)).toEqual({ posicoesSemana: 70, capacidadeSemana: 70, pessoasNecessarias: 14, sobra: 0 });
    expect(balancoDaEquipe(t, 10, 5)).toMatchObject({ pessoasNecessarias: 14, sobra: -4 });
    expect(balancoDaEquipe(t, 10, 0).pessoasNecessarias).toBe(0);
  });
  it('sugestão de cobertura reparte a equipe entre turnos e dias', () => {
    expect(sugerirCobertura(14, 2, 5)).toEqual(Array(7).fill(5));
    expect(sugerirCobertura(3, 1, 5)).toEqual(Array(7).fill(2));
    expect(sugerirCobertura(1, 3, 5)).toEqual(Array(7).fill(1));
    expect(sugerirCobertura(0, 2, 5)).toEqual(Array(7).fill(0));
  });
  it('inicial do turno', () => { expect([inicialDoTurno('manhã', 0), inicialDoTurno('', 2)]).toEqual(['M', '3']); });
});
