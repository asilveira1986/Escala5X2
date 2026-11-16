import { describe, expect, it } from 'vitest';
import { agruparPorDia, cruzaMeiaNoite, lerDaterange, lerHora, lerQuantidades, montarFaixa, periodoAusencia, rotuloFaixa, type Demanda } from './cobertura';

const d = (dia: number, ini: number, fim: number): Demanda => ({ id: `${dia}-${ini}`, setor_id: null, dia_semana: dia, faixa_inicio_min: ini, faixa_fim_min: fim, minimo: 1, ideal: null });

describe('cobertura', () => {
  it('lê horários HH:MM e rejeita o resto', () => {
    expect(lerHora('08:30')).toBe(510);
    expect(lerHora('24:00')).toBeNull();
    expect(lerHora('8:30')).toBeNull();
    expect(lerHora('')).toBeNull();
  });
  it('monta a faixa: 00:00 de saída é fim do dia; saída menor atravessa a meia-noite; igual é inválido', () => {
    expect(montarFaixa('08:00', '12:00')).toEqual({ inicioMin: 480, fimMin: 720 });
    expect(montarFaixa('18:00', '00:00')).toEqual({ inicioMin: 1080, fimMin: 1440 });
    expect(montarFaixa('22:00', '06:00')).toEqual({ inicioMin: 1320, fimMin: 360 });
    expect(montarFaixa('08:00', '08:00')).toBeNull();
    expect(montarFaixa('00:00', '00:00')).toEqual({ inicioMin: 0, fimMin: 1440 }); // dia todo
    expect(montarFaixa('xx', '08:00')).toBeNull();
  });
  it('rótulos legíveis', () => {
    expect(rotuloFaixa(d(1, 480, 720))).toBe('08:00–12:00');
    expect(rotuloFaixa(d(1, 1080, 1440))).toBe('18:00–24:00');
    expect(rotuloFaixa(d(1, 1320, 360))).toBe('22:00–06:00 (dia seguinte)');
    expect(cruzaMeiaNoite(d(1, 1320, 360))).toBe(true);
    expect(cruzaMeiaNoite(d(1, 480, 720))).toBe(false);
  });
  it('agrupa de segunda a domingo e ordena por horário; esconde dias sem demanda', () => {
    const g = agruparPorDia([d(0, 480, 720), d(1, 900, 1000), d(1, 480, 720), d(6, 480, 720)]);
    expect(g.map((x) => x.dia.curto)).toEqual(['seg', 'sáb', 'dom']);
    expect(g[0]!.itens.map((i) => i.faixa_inicio_min)).toEqual([480, 900]);
  });
  it('quantidades: mínimo obrigatório, ideal opcional e nunca abaixo do mínimo', () => {
    expect(lerQuantidades('2', '')).toEqual({ minimo: 2, ideal: null });
    expect(lerQuantidades('2', '3')).toEqual({ minimo: 2, ideal: 3 });
    expect(lerQuantidades('0', null)).toEqual({ minimo: 0, ideal: null });
    expect(lerQuantidades('3', '2')).toMatch(/ideal/);
    expect(lerQuantidades('', '')).toMatch(/mínimo/);
    expect(lerQuantidades('1.5', '')).toMatch(/mínimo/);
    expect(lerQuantidades('-1', '')).toMatch(/mínimo/);
  });
  it('período de ausência: fim inclusivo vira fim exclusivo; valida ordem e tamanho', () => {
    expect(periodoAusencia('2027-02-01', '2027-02-15')).toEqual({ texto: '[2027-02-01,2027-02-16)' });
    expect(periodoAusencia('2026-12-31', '2026-12-31')).toEqual({ texto: '[2026-12-31,2027-01-01)' });
    expect(periodoAusencia('2027-02-15', '2027-02-01')).toMatch(/antes/);
    expect(periodoAusencia('', '2027-02-01')).toMatch(/datas/);
    expect(periodoAusencia('2027-01-01', '2030-01-01')).toMatch(/longo/);
  });
  it('lê o daterange do banco', () => {
    expect(lerDaterange('[2027-02-01,2027-02-16)')).toEqual({ inicio: '2027-02-01', fim: '2027-02-15' });
    expect(lerDaterange('empty')).toBeNull();
  });
});
