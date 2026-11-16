import { describe, expect, it } from 'vitest';
import { agruparPorEscala, horasLiquidasMin, lerPeriodo, proximoTurno, semanasDoPeriodo, textoTurno, type LinhaMinhaEscala } from './minha-escala';

const esc = (id: string, periodo: string, versao = 1) => ({ id, nome: `Escala ${id}`, periodo, versao, publicada_em: '2027-01-01T10:00:00Z', hash_publicado: `h${id}` });
const t = (escala_id: string, data: string, ini = 480, fim = 1020, inter = 60, e = esc(escala_id, '[2027-02-01,2027-03-01)')): LinhaMinhaEscala =>
  ({ escala_id, data, tipo: 'trabalho', inicio_min: ini, fim_min: fim, intervalo_min: inter, escala: e });

describe('Minha escala', () => {
  it('converte o período do banco (fim exclusivo) em datas inclusivas', () => {
    expect(lerPeriodo('[2027-02-01,2027-03-01)')).toEqual({ inicio: '2027-02-01', fim: '2027-02-28' });
    expect(lerPeriodo('[2026-12-01,2027-01-01)').fim).toBe('2026-12-31');
    expect(() => lerPeriodo('x')).toThrow();
  });
  it('agrupa por escala, ordena os dias, marca a ciência e põe a mais recente primeiro', () => {
    const r = agruparPorEscala(
      [t('b', '2027-03-02', 480, 1020, 60, esc('b', '[2027-03-01,2027-04-01)')), t('a', '2027-02-03'), t('a', '2027-02-01')],
      [{ escala_id: 'a', ciente_em: '2027-02-01T12:00:00Z' }],
    );
    expect(r.map((e) => e.id)).toEqual(['b', 'a']);
    expect(r[1]!.dias.map((d) => d.data)).toEqual(['2027-02-01', '2027-02-03']);
    expect(r[1]!.cienteEm).toBe('2027-02-01T12:00:00Z');
    expect(r[0]!.cienteEm).toBeNull();
    expect(r[0]).toMatchObject({ inicio: '2027-03-01', fim: '2027-03-31', hash: 'hb' });
  });
  it('mesma data de início: a versão mais nova vem antes', () => {
    const r = agruparPorEscala([t('v1', '2027-02-01', 480, 1020, 60, esc('v1', '[2027-02-01,2027-03-01)', 1)), t('v2', '2027-02-01', 480, 1020, 60, esc('v2', '[2027-02-01,2027-03-01)', 2))], []);
    expect(r.map((e) => e.id)).toEqual(['v2', 'v1']);
  });
  it('horas líquidas descontam o intervalo; folga não conta', () => {
    expect(horasLiquidasMin({ tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 })).toBe(480);
    expect(horasLiquidasMin({ tipo: 'trabalho', inicioMin: 1320, fimMin: 1800, intervaloMin: 60 })).toBe(420);
    expect(horasLiquidasMin({ tipo: 'folga', inicioMin: null, fimMin: null, intervaloMin: 0 })).toBe(0);
  });
  it('próximo turno: hoje conta até terminar; depois vai para o seguinte; turno noturno de ontem ainda vale de madrugada', () => {
    const e = agruparPorEscala([t('a', '2027-02-02'), t('a', '2027-02-03'), t('a', '2027-02-01', 1320, 1800, 60)], []);
    expect(proximoTurno(e, '2027-02-02', 7 * 60)!.dia.data).toBe('2027-02-02');
    expect(proximoTurno(e, '2027-02-02', 12 * 60)!.dia.data).toBe('2027-02-02'); // em andamento
    expect(proximoTurno(e, '2027-02-02', 18 * 60)!.dia.data).toBe('2027-02-03');
    expect(proximoTurno(e, '2027-02-02', 20 * 60 + 1)!.dia.data).toBe('2027-02-03');
    // às 03:00 de 02/02, o turno que começou 01/02 às 22:00 (até 06:00 de 02/02) está em andamento
    expect(proximoTurno(e, '2027-02-02', 3 * 60)!.dia.data).toBe('2027-02-01');
    expect(proximoTurno(e, '2027-02-04', 0)).toBeNull();
    expect(proximoTurno([], '2027-02-04', 0)).toBeNull();
  });
  it('semanas começam no domingo e completam com vazios', () => {
    const s = semanasDoPeriodo('2027-02-01', '2027-02-28'); // 01/02/2027 é segunda
    expect(s[0]).toEqual([null, '2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05', '2027-02-06']);
    expect(s.at(-1)).toEqual(['2027-02-28', null, null, null, null, null, null]);
    expect(s.every((w) => w.length === 7)).toBe(true);
    expect(s).toHaveLength(5);
  });
  it('texto do turno, inclusive noturno e demais tipos', () => {
    expect(textoTurno({ tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 })).toBe('08:00 às 17:00 · intervalo de 60 min');
    expect(textoTurno({ tipo: 'trabalho', inicioMin: 1320, fimMin: 1800, intervaloMin: 0 })).toBe('22:00 às 06:00 (dia seguinte)');
    expect(textoTurno({ tipo: 'folga', inicioMin: null, fimMin: null, intervaloMin: 0 })).toBe('Folga');
    expect(textoTurno({ tipo: 'ferias', inicioMin: null, fimMin: null, intervaloMin: 0 })).toBe('Férias');
  });
});
