import { describe, expect, it } from 'vitest';
import { diffEscalas, rotuloDoDia, type CelulaDiff } from '@/lib/escala-diff';

const t = (c: string, data: string, ini = 480, fim = 1020, intervalo = 60): CelulaDiff => ({ colaboradorId: c, data, tipo: 'trabalho', inicioMin: ini, fimMin: fim, intervaloMin: intervalo });
const f = (c: string, data: string, tipo = 'folga'): CelulaDiff => ({ colaboradorId: c, data, tipo });

describe('comparação de versões da escala', () => {
  it('rótulos: horário com intervalo, tipos de ausência e dia partido', () => {
    expect(rotuloDoDia([t('a', 'x')])).toBe('08:00–17:00 (int. 60 min)');
    expect(rotuloDoDia([t('a', 'x', 480, 720, 0)])).toBe('08:00–12:00');
    expect(rotuloDoDia([f('a', 'x', 'ferias')])).toBe('Férias');
    expect(rotuloDoDia([t('a', 'x', 840, 1080, 0), t('a', 'x', 480, 720, 0)])).toBe('08:00–12:00 + 14:00–18:00');
  });
  it('versões iguais não têm diferença', () => {
    const v = [t('a', '2027-03-01'), f('a', '2027-03-02')];
    expect(diffEscalas(v, [...v].reverse())).toMatchObject({ mudancas: [], pessoas: 0, dias: 0 });
  });
  it('troca de folga, mudança de horário e dia que só existe numa versão', () => {
    const de = [t('a', '2027-03-01'), f('a', '2027-03-02'), t('b', '2027-03-01'), t('b', '2027-03-02')];
    const para = [f('a', '2027-03-01'), t('a', '2027-03-02'), t('b', '2027-03-01', 600, 1140), t('b', '2027-03-02'), t('b', '2027-03-03')];
    const d = diffEscalas(de, para);
    expect(d.mudancas.map((m) => [m.data, m.colaboradorId, m.antes, m.depois])).toEqual([
      ['2027-03-01', 'a', '08:00–17:00 (int. 60 min)', 'Folga'], ['2027-03-01', 'b', '08:00–17:00 (int. 60 min)', '10:00–19:00 (int. 60 min)'],
      ['2027-03-02', 'a', 'Folga', '08:00–17:00 (int. 60 min)'], ['2027-03-03', 'b', null, '08:00–17:00 (int. 60 min)'],
    ]);
    expect(d).toMatchObject({ pessoas: 2, dias: 3, entraramEmTrabalho: 2, sairamDeTrabalho: 1, horarioMudou: 1 });
  });
});
