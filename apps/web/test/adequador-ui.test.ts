import { describe, expect, it } from 'vitest';
import { ajustarTurnoAJornada, compararJornadas, diasDaJornada, liquidaDiariaMin, PRESETS_JORNADA, turnoEfetivo, balancoDaEquipe, horaDeMinutos, horasTexto, inicialDoTurno, liquidoDoTurno, minutosDeHora, sugerirCobertura } from '@/lib/adequador-ui';

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

describe('jornada de trabalho', () => {
  it('horas líquidas por dia, arredondadas a 5 minutos, e dias sugeridos', () => {
    expect([liquidaDiariaMin(40, 5), liquidaDiariaMin(44, 6), liquidaDiariaMin(44, 5), liquidaDiariaMin(36, 5), liquidaDiariaMin(30, 5)]).toEqual([480, 440, 530, 430, 360]);
    expect([diasDaJornada(30), diasDaJornada(40), diasDaJornada(42), diasDaJornada(44)]).toEqual([5, 5, 6, 6]);
  });
  it('ajusta a saída mantendo entrada e intervalo (inclusive turno que vira a noite) e recusa o que não cabe', () => {
    expect(ajustarTurnoAJornada({ inicio: '08:00', fim: '17:00', intervalo: 60 }, 40, 5)).toBe('17:00');           // 8h + 1h
    expect(ajustarTurnoAJornada({ inicio: '08:00', fim: '17:00', intervalo: 60 }, 44, 5)).toBe('17:50');           // 8h50 + 1h
    expect(ajustarTurnoAJornada({ inicio: '08:00', fim: '17:00', intervalo: 60 }, 36, 6)).toBe('15:00');           // 6h + 1h
    expect(ajustarTurnoAJornada({ inicio: '22:00', fim: '06:00', intervalo: 60 }, 40, 5)).toBe('07:00');           // vira a noite
    expect(ajustarTurnoAJornada({ inicio: '08:00', fim: '17:00', intervalo: 0 }, 0, 5)).toBeNull();
    expect(ajustarTurnoAJornada({ inicio: '08:00', fim: '17:00', intervalo: 0 }, 44, 0)).toBeNull();
    expect(ajustarTurnoAJornada({ inicio: 'x', fim: '17:00', intervalo: 0 }, 40, 5)).toBeNull();
    expect(ajustarTurnoAJornada({ inicio: '08:00', fim: '17:00', intervalo: 600 }, 44, 3)).toBeNull();           // passaria de 24 h
  });
  it('turno efetivo: só muda quem segue a jornada e só quando há jornada', () => {
    const t = { chave: 'a', nome: 'M', inicio: '08:00', fim: '17:00', intervalo: 60, modeloId: null, segueJornada: true };
    expect(turnoEfetivo(t, 36, 5).fim).toBe('16:10');                  // 7h10 líquidas + 1h
    expect(turnoEfetivo(t, null, 5)).toBe(t);
    expect(turnoEfetivo({ ...t, segueJornada: false }, 36, 5).fim).toBe('17:00');
    expect(turnoEfetivo(t, 0, 5)).toBe(t);
  });
  it('comparar jornadas: menos horas ou mais dias folgados exigem mais gente; sobra/falta por setor', () => {
    const l = compararJornadas([60, 12], [12, 3], [{ horas: 44, dias: 6 }, { horas: 40, dias: 5 }, { horas: 36, dias: 5 }]);
    expect(l[0]).toMatchObject({ horas: 44, dias: 6, pessoasNecessarias: 10 + 2, equipe: 15, sobra: (12 - 10) + (3 - 2), horasEquipeSemana: 15 * 44 });
    expect(l[1]).toMatchObject({ pessoasNecessarias: 12 + 3, sobra: 0 });
    expect(l[1]!.liquidaDiariaMin).toBe(480);
    expect(l[2]!.liquidaDiariaMin).toBe(430);
    const setoresCompensam = compararJornadas([50, 10], [1, 20], [{ horas: 40, dias: 5 }])[0]!;
    expect(setoresCompensam.sobra).toBe((1 - 10) + (20 - 2));                                                          // a sobra de um setor não esconde a falta do outro na soma, mas cada um é contado
    expect(PRESETS_JORNADA.length).toBeGreaterThanOrEqual(5);
  });
});

import { exigenciaDaFase, faseNaData, fasesDaJornada } from '@/lib/adequador-ui';
import { parseDaterange } from '@jc/rules-engine';

describe('fim da 6x1: fases da jornada', () => {
  const regras = [
    { codigo: 'EC141_F2', vigencia: '[2027-12-15,)', parametros: { max_semanal_min: 2400, max_diaria_min: 480, folgas_semana: 2 } },
    { codigo: 'LEGADO_44H', vigencia: '[1970-01-01,2026-12-15)', parametros: { max_semanal_min: 2640, max_diaria_min: 480, folgas_semana: 1 } },
    { codigo: 'EC141_F1', vigencia: '[2026-12-15,2027-12-15)', parametros: { max_semanal_min: 2520, max_diaria_min: 480, folgas_semana: 2 } },
    { codigo: 'OUTRA', vigencia: '[2026-12-15,)', parametros: {} },
  ];
  const fases = fasesDaJornada(regras, parseDaterange);

  it('ordena do legado à fase 2 e deriva horas, dias e datas das regras', () => {
    expect(fases.map((f) => [f.codigo, f.horas, f.dias, f.inicio])).toEqual([['LEGADO_44H', 44, 6, null], ['EC141_F1', 42, 5, '2026-12-15'], ['EC141_F2', 40, 5, '2027-12-15']]);
  });
  it('acha a fase de uma data', () => {
    expect(faseNaData(fases, '2026-11-17')?.codigo).toBe('LEGADO_44H');
    expect(faseNaData(fases, '2026-12-15')?.codigo).toBe('EC141_F1');
    expect(faseNaData(fases, '2028-01-01')?.codigo).toBe('EC141_F2');
  });
  it('avisa quando a fase 1 passa de 8h por dia e sugere 40h', () => {
    expect(exigenciaDaFase(fases[1]!)).toEqual({ liquidaDiariaMin: 505, excedeDiaria: true, alternativaHoras: 40 });
    expect(exigenciaDaFase(fases[2]!).excedeDiaria).toBe(false);
  });
  it('ignora regra sem parâmetros ou com vigência inválida', () => {
    expect(fasesDaJornada([{ codigo: 'EC141_F1', vigencia: 'lixo', parametros: { max_semanal_min: 2520 } }, { codigo: 'EC141_F2', vigencia: null, parametros: null }], parseDaterange)).toEqual([]);
  });
});
