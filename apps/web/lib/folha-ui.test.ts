import { describe, expect, it } from 'vitest';
import { lerCompetencia, lerOpcoesFolha, mesEncerrado, nomeArquivo, rotuloMes } from './folha-ui';

describe('fechamento: competência e arquivo', () => {
  it('o padrão é o mês passado; parâmetro inválido volta ao padrão', () => {
    expect(lerCompetencia(undefined, '2027-03-15')).toEqual({ mes: '2027-02', dia: '2027-02-01' });
    expect(lerCompetencia(undefined, '2027-01-10').mes).toBe('2026-12');
    expect(lerCompetencia('2026-11', '2027-03-15')).toEqual({ mes: '2026-11', dia: '2026-11-01' });
    for (const ruim of ['2027-13', '2027-00', '27-01', "2027-01'; drop", '', null, 5]) expect(lerCompetencia(ruim, '2027-03-15').mes, String(ruim)).toBe('2027-02');
  });
  it('só mês encerrado pode ser fechado', () => {
    expect(mesEncerrado('2027-02', '2027-03-01')).toBe(true);
    expect(mesEncerrado('2027-03', '2027-03-31')).toBe(false);
    expect(mesEncerrado('2027-04', '2027-03-31')).toBe(false);
    expect(mesEncerrado('2026-12', '2027-01-01')).toBe(true);
  });
  it('rótulo e nome de arquivo seguros', () => {
    expect(rotuloMes('2027-02')).toBe('fevereiro de 2027');
    expect(nomeArquivo('Loja Alfa Ltda.', '2027-02', 2, 'csv')).toBe('folha-loja-alfa-ltda-2027-02-v2.csv');
    expect(nomeArquivo('Açougue São João & Filhos', '2027-12', 1, 'xlsx')).toBe('folha-acougue-sao-joao-filhos-2027-12-v1.xlsx');
    expect(nomeArquivo('../../etc/passwd"; x', '2027-02', 1, 'csv')).toBe('folha-etc-passwd-x-2027-02-v1.csv');
    expect(nomeArquivo('###', '2027-02', 1, 'csv')).toBe('folha-empresa-2027-02-v1.csv');
  });
});

describe('fechamento: origem das horas', () => {
  it('sem escolha, usa o ponto quando o mês tem marcações importadas e a escala quando não tem', () => {
    expect(lerOpcoesFolha(undefined, undefined, true)).toEqual({ origem: 'ponto', semMarcacao: 'escala' });
    expect(lerOpcoesFolha(undefined, undefined, false)).toEqual({ origem: 'escala', semMarcacao: 'escala' });
  });
  it('a escolha explícita vale, e valor estranho volta ao padrão', () => {
    expect(lerOpcoesFolha('escala', 'falta', true)).toEqual({ origem: 'escala', semMarcacao: 'falta' });
    expect(lerOpcoesFolha('ponto', undefined, false).origem).toBe('ponto');
    expect(lerOpcoesFolha('x', 'y', true)).toEqual({ origem: 'ponto', semMarcacao: 'escala' });
    expect(lerOpcoesFolha(['ponto'], 5, false)).toEqual({ origem: 'escala', semMarcacao: 'escala' });
  });
});
