import { describe, expect, it } from 'vitest';
import type { Violacao } from '@jc/rules-engine';
import { ausenciasPorCelula, diasComCoberturaBaixa, aplicarPincel, chave, contarTrabalhando, diasDoPeriodo, indexar, paraGravacao, repetirPrimeiraSemana, rotuloCelula, severidadePorCelula, type Celula, type Modelo } from './escala-editor';

const manha: Modelo = { id: 'm1', nome: 'Manhã', inicioMin: 480, fimMin: 1020, intervaloMin: 60, cor: '#2563eb' };

describe('editor de escalas (lógica da grade)', () => {
  it('lista os dias do período, inclusive na virada de mês e ano', () => {
    expect(diasDoPeriodo('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(diasDoPeriodo('2027-02-01', '2027-02-28')).toHaveLength(28);
    expect(diasDoPeriodo('2027-02-02', '2027-02-01')).toEqual([]);
  });
  it('o pincel substitui só a célula escolhida', () => {
    let a: Celula[] = [{ colaboradorId: 'a', data: '2027-01-04', tipo: 'folga' }, { colaboradorId: 'b', data: '2027-01-04', tipo: 'folga' }];
    a = aplicarPincel(a, 'a', '2027-01-04', { tipo: 'modelo', modelo: manha });
    expect(a).toHaveLength(2);
    expect(a.find((x) => x.colaboradorId === 'a')).toMatchObject({ tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60, modeloId: 'm1' });
    expect(a.find((x) => x.colaboradorId === 'b')!.tipo).toBe('folga');
    a = aplicarPincel(a, 'a', '2027-01-04', { tipo: 'folga' });
    expect(a.find((x) => x.colaboradorId === 'a')).toEqual({ colaboradorId: 'a', data: '2027-01-04', tipo: 'folga' });
    expect(aplicarPincel(a, 'a', '2027-01-04', { tipo: 'limpar' }).map((x) => x.colaboradorId)).toEqual(['b']);
    expect(a.length).toBe(2); // imutável
  });
  it('repete a primeira semana nas seguintes e substitui o que havia depois', () => {
    const base: Celula[] = [
      { colaboradorId: 'a', data: '2027-01-04', tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 },
      { colaboradorId: 'a', data: '2027-01-09', tipo: 'folga' },
      { colaboradorId: 'a', data: '2027-01-12', tipo: 'folga' }, // será substituído (terça da 2ª semana)
    ];
    const r = repetirPrimeiraSemana(base, '2027-01-04', '2027-01-24');
    expect(r.filter((x) => x.tipo === 'trabalho').map((x) => x.data)).toEqual(['2027-01-04', '2027-01-11', '2027-01-18']);
    expect(r.filter((x) => x.tipo === 'folga').map((x) => x.data)).toEqual(['2027-01-09', '2027-01-16', '2027-01-23']);
    expect(r.some((x) => x.data === '2027-01-12')).toBe(false);
  });
  it('semana final incompleta recebe só os dias que cabem', () => {
    const base: Celula[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ colaboradorId: 'a', data: `2027-01-${String(4 + i).padStart(2, '0')}`, tipo: 'folga' as const }));
    expect(repetirPrimeiraSemana(base, '2027-01-04', '2027-01-13')).toHaveLength(7 + 3);
  });
  it('conta quem trabalha por dia (folga não conta, mesma pessoa não conta duas vezes)', () => {
    const a: Celula[] = [
      { colaboradorId: 'a', data: '2027-01-04', tipo: 'trabalho', inicioMin: 0, fimMin: 60 },
      { colaboradorId: 'a', data: '2027-01-04', tipo: 'trabalho', inicioMin: 120, fimMin: 180 },
      { colaboradorId: 'b', data: '2027-01-04', tipo: 'trabalho', inicioMin: 0, fimMin: 60 },
      { colaboradorId: 'c', data: '2027-01-04', tipo: 'folga' },
    ];
    expect(contarTrabalhando(a, ['2027-01-04', '2027-01-05'])).toEqual([2, 0]);
  });
  it('cada célula mostra a pior severidade', () => {
    const v = (severidade: Violacao['severidade'], colaboradorId?: string, data?: string): Violacao => ({ codigo: 'INTERJORNADA', severidade, colaboradorId, data, mensagem: 'x', detalhe: {} });
    const m = severidadePorCelula([v('info', 'a', '2027-01-04'), v('bloqueio', 'a', '2027-01-04'), v('alerta', 'a', '2027-01-04'), v('alerta', 'b', '2027-01-05'), v('bloqueio')]);
    expect(m.get(chave('a', '2027-01-04'))).toBe('bloqueio');
    expect(m.get(chave('b', '2027-01-05'))).toBe('alerta');
    expect(m.size).toBe(2);
  });
  it('rótulos legíveis', () => {
    expect(rotuloCelula([])).toEqual({ curto: '', longo: 'Sem lançamento' });
    expect(rotuloCelula([{ colaboradorId: 'a', data: 'd', tipo: 'trabalho', inicioMin: 1320, fimMin: 1800, intervaloMin: 60 }])).toEqual({ curto: '22:00', longo: 'Trabalho 22:00–06:00, intervalo 60 min' });
    expect(rotuloCelula([{ colaboradorId: 'a', data: 'd', tipo: 'folga' }]).curto).toBe('F');
    expect(rotuloCelula([{ colaboradorId: 'a', data: 'd', tipo: 'ferias' }]).longo).toBe('Férias');
    expect(rotuloCelula([{ colaboradorId: 'a', data: 'd', tipo: 'trabalho', inicioMin: 0, fimMin: 60 }, { colaboradorId: 'a', data: 'd', tipo: 'trabalho', inicioMin: 120, fimMin: 180 }]).curto).toBe('2×');
  });
  it('indexa por pessoa e dia e prepara a gravação com o modelo de turno', () => {
    const a: Celula[] = [{ colaboradorId: 'a', data: '2027-01-04', tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60, modeloId: 'm1' }, { colaboradorId: 'a', data: '2027-01-05', tipo: 'folga' }];
    expect(indexar(a).get(chave('a', '2027-01-05'))).toHaveLength(1);
    expect(paraGravacao(a)).toEqual([
      { colaboradorId: 'a', data: '2027-01-04', tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60, turnoModeloId: 'm1' },
      { colaboradorId: 'a', data: '2027-01-05', tipo: 'folga', inicioMin: null, fimMin: null, intervaloMin: 0, turnoModeloId: null },
    ]);
  });
  it('marca os dias de férias/afastamento dentro do período mostrado', () => {
    const m = ausenciasPorCelula([{ colaboradorId: 'a', inicio: '2027-01-02', fim: '2027-01-05', tipo: 'ferias' }, { colaboradorId: 'b', inicio: '2027-01-06', fim: '2027-02-10', tipo: 'afastamento' }], ['2027-01-04', '2027-01-05', '2027-01-06']);
    expect(m.get(chave('a', '2027-01-04'))).toBe('ferias');
    expect(m.get(chave('a', '2027-01-06'))).toBeUndefined();
    expect(m.get(chave('b', '2027-01-06'))).toBe('afastamento');
    expect(m.size).toBe(3);
  });
  it('destaca só os dias com cobertura abaixo do mínimo', () => {
    const v = (codigo: Violacao['codigo'], data?: string): Violacao => ({ codigo, severidade: 'alerta', data, mensagem: 'x', detalhe: {} });
    expect([...diasComCoberturaBaixa([v('COBERTURA_MINIMA', '2027-01-04'), v('COBERTURA_IDEAL', '2027-01-05'), v('COBERTURA_MINIMA')])]).toEqual(['2027-01-04']);
  });
});
