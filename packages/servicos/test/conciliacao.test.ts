import { describe, expect, it } from 'vitest';
import { conciliarPonto, type MarcacaoPonto } from '../src';
import { colab } from '../../rules-engine/test/util';
import { entrada } from './otimizador-util';

// 01/02/2027 é segunda-feira; as marcações são dadas em horário de São Paulo (UTC-3)
const m = (dia: string, hora: string, c = 'a'): MarcacaoPonto => ({ colaborador_id: c, momento: `${dia}T${hora}:00-03:00` });
const turno = (data: string, ini = 480, fim = 1020, inter = 60, c = 'a') => ({ colaboradorId: c, data, tipo: 'trabalho' as const, inicioMin: ini, fimMin: fim, intervaloMin: inter });
const e = (alocs: ReturnType<typeof turno>[], extra = {}) => entrada({ alocacoes: alocs, ...extra }, '2027-02-01', '2027-02-07');
const dia = (r: ReturnType<typeof conciliarPonto>, d: string) => r.dias.find((x) => x.data === d)!;

describe('conciliarPonto', () => {
  it('dia normal (08–17, 1h de intervalo): apura 8h e não aponta nada', () => {
    const r = conciliarPonto(e([turno('2027-02-01')]), [m('2027-02-01', '08:00'), m('2027-02-01', '12:00'), m('2027-02-01', '13:00'), m('2027-02-01', '17:00')]);
    expect(dia(r, '2027-02-01')).toMatchObject({ previstoLiquidoMin: 480, apuradoMin: 480, codigos: [], intervaloRealizadoMin: 60, marcacoes: ['08:00', '12:00', '13:00', '17:00'] });
    expect(r.resumo[0]).toMatchObject({ diasPrevistos: 1, diasSemMarcacao: 0, previstoMin: 480, apuradoMin: 480, diasComDivergencia: 0 });
  });
  it('variações de até 5 minutos em cada ponta (até 10 no dia) não contam', () => {
    const r = conciliarPonto(e([turno('2027-02-01')]), [m('2027-02-01', '08:05'), m('2027-02-01', '12:00'), m('2027-02-01', '13:00'), m('2027-02-01', '16:55')]);
    expect(dia(r, '2027-02-01').codigos).toEqual([]);
    expect(dia(r, '2027-02-01').apuradoMin).toBe(470);               // a apuração mostra o real; a tolerância só evita o apontamento
  });
  it('passou da tolerância: atraso, saída antecipada e tempo além do turno', () => {
    const atraso = conciliarPonto(e([turno('2027-02-01')]), [m('2027-02-01', '08:20'), m('2027-02-01', '17:00')]);
    expect(dia(atraso, '2027-02-01')).toMatchObject({ codigos: ['ATRASO'], atrasoMin: 20 });
    const cedo = conciliarPonto(e([turno('2027-02-01')]), [m('2027-02-01', '08:00'), m('2027-02-01', '16:30')]);
    expect(dia(cedo, '2027-02-01')).toMatchObject({ codigos: ['SAIDA_ANTECIPADA'], saidaAntecipadaMin: 30 });
    const extra = conciliarPonto(e([turno('2027-02-01')]), [m('2027-02-01', '08:00'), m('2027-02-01', '17:45')]);
    expect(dia(extra, '2027-02-01')).toMatchObject({ codigos: ['HORA_EXTRA_REALIZADA'], horaExtraMin: 45, apuradoMin: 585 });
    const antes = conciliarPonto(e([turno('2027-02-01')]), [m('2027-02-01', '07:30'), m('2027-02-01', '17:00')]);
    expect(dia(antes, '2027-02-01')).toMatchObject({ codigos: ['HORA_EXTRA_REALIZADA'], horaExtraMin: 30 });
    expect(conciliarPonto(e([turno('2027-02-01')]), [m('2027-02-01', '08:20'), m('2027-02-01', '16:40')]).resumo[0]).toMatchObject({ atrasoMin: 20 });
  });
  it('sem marcação em dia de trabalho = possível falta; número ímpar de marcações não dá para apurar', () => {
    const r = conciliarPonto(e([turno('2027-02-01'), turno('2027-02-02')]), [m('2027-02-02', '08:00'), m('2027-02-02', '12:00'), m('2027-02-02', '13:00')]);
    expect(dia(r, '2027-02-01')).toMatchObject({ codigos: ['SEM_MARCACAO'], apuradoMin: null, marcacoes: [] });
    expect(dia(r, '2027-02-02')).toMatchObject({ codigos: ['MARCACAO_IMPAR'], apuradoMin: null });
    expect(r.resumo[0]).toMatchObject({ diasPrevistos: 2, diasSemMarcacao: 1, diasComDivergencia: 2 });
  });
  it('intervalo menor que o previsto é apontado', () => {
    const r = conciliarPonto(e([turno('2027-02-01')]), [m('2027-02-01', '08:00'), m('2027-02-01', '12:00'), m('2027-02-01', '12:30'), m('2027-02-01', '17:00')]);
    expect(dia(r, '2027-02-01')).toMatchObject({ codigos: ['INTERVALO_REDUZIDO'], intervaloRealizadoMin: 30, apuradoMin: 510 });
  });
  it('turno da noite que vira o dia: as marcações da madrugada pertencem ao turno de ontem', () => {
    const r = conciliarPonto(e([turno('2027-02-01', 1320, 1800)]), [m('2027-02-01', '22:00'), m('2027-02-02', '06:03')]);
    expect(r.dias).toHaveLength(1);
    expect(dia(r, '2027-02-01')).toMatchObject({ codigos: [], apuradoMin: 483, previstoLiquidoMin: 420, marcacoes: ['22:00', '06:03'] });
  });
  it('marcação em dia de folga ou de férias é apontada', () => {
    const r = conciliarPonto(e([turno('2027-02-01')], { ausencias: [{ colaboradorId: 'a', inicio: '2027-02-04', fim: '2027-02-05', tipo: 'ferias' }] }),
      [m('2027-02-03', '09:00'), m('2027-02-03', '13:00'), m('2027-02-04', '09:00'), m('2027-02-04', '10:00'), m('2027-02-01', '08:00'), m('2027-02-01', '17:00')]);
    expect(dia(r, '2027-02-03')).toMatchObject({ codigos: ['MARCACAO_EM_FOLGA'], previstoLiquidoMin: 0, apuradoMin: 240 });
    expect(dia(r, '2027-02-04')).toMatchObject({ codigos: ['MARCACAO_EM_AUSENCIA'] });
    expect(dia(r, '2027-02-01').codigos).toEqual([]);
  });
  it('separa as pessoas e ignora marcações de quem não está na escala', () => {
    const base = e([turno('2027-02-01'), turno('2027-02-01', 480, 1020, 60, 'b')]);
    base.colaboradores = [...base.colaboradores, colab({ colaboradorId: 'b', nome: 'Bia', tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, admissao: '2020-01-01' })];
    const r = conciliarPonto(base, [m('2027-02-01', '08:00'), m('2027-02-01', '17:00'), m('2027-02-01', '08:00', 'x'), m('2027-02-01', '08:40', 'b'), m('2027-02-01', '17:00', 'b')]);
    expect(r.dias.filter((d) => d.colaboradorId === 'a').map((d) => d.codigos)).toEqual([[]]);
    expect(r.dias.filter((d) => d.colaboradorId === 'b').map((d) => d.codigos)).toEqual([['ATRASO']]);
    expect(r.dias.some((d) => d.colaboradorId === 'x')).toBe(false);
    expect(r.resumo.map((x) => x.nome)).toEqual(['Ana', 'Bia']);
  });
  it('marcações fora do período da escala são ignoradas e a ordem de chegada não importa', () => {
    const marcas = [m('2027-02-01', '17:00'), m('2027-03-20', '09:00'), m('2027-02-01', '08:00')];
    const r = conciliarPonto(e([turno('2027-02-01')]), marcas);
    expect(dia(r, '2027-02-01')).toMatchObject({ codigos: [], apuradoMin: 540 });
    expect(r.dias).toHaveLength(1);
  });
  it('tolerância configurável', () => {
    const marcas = [m('2027-02-01', '08:08'), m('2027-02-01', '17:00')];
    expect(dia(conciliarPonto(e([turno('2027-02-01')]), marcas), '2027-02-01').codigos).toEqual(['ATRASO']);
    expect(dia(conciliarPonto(e([turno('2027-02-01')]), marcas, { toleranciaMin: 10 }), '2027-02-01').codigos).toEqual([]);
  });
});
