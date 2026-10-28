import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  camposObrigatoriosSemColuna, errosParaCsv, lerPlanilha, ErroPlanilha, parseCnpj, formatarCnpj, parseCpf, parseData, parseDinheiroCentavos,
  parseEscolaridade, parseJornadaMin, parseTelefone, parseTipoEscala, sugerirMapeamento, validarColaboradores,
} from '../src';

const enc = (s: string) => new TextEncoder().encode(s);

describe('parsers', () => {
  it.each([
    ['111.444.777-35', '11144477735'], ['11144477735', '11144477735'],
    ['529.982.247-25', '52998224725'], ['111.111.111-11', null], ['123', null], ['', null], ['111.444.777-36', null],
  ])('cpf %s', (v, esperado) => expect(parseCpf(v)).toBe(esperado));
  it('recompõe zeros à esquerda perdidos pelo Excel quando o dígito verificador confere', () => {
    const completo = cpfValido('012345678');
    expect(completo.startsWith('0')).toBe(true);
    expect(parseCpf(String(Number(completo)))).toBe(completo);
    expect(parseCpf(String(Number(completo) + 1))).toBeNull();
  });
  it.each([
    ['15/12/2026', '2026-12-15'], ['1/2/2020', '2020-02-01'], ['2026-12-15', '2026-12-15'], ['15-12-26', '2026-12-15'],
    ['15/12/85', '1985-12-15'], ['31/02/2026', null], ['2026-13-01', null], ['ontem', null], ['', null],
  ])('data %s', (v, esperado) => expect(parseData(v)).toBe(esperado));
  it.each([
    ['1.234,56', 123_456], ['R$ 2.500,00', 250_000], ['1234,5', 123_450], ['1234.56', 123_456], ['1.234', 123_400],
    ['1.234.567,89', 123_456_789], ['3000', 300_000], ['abc', null], ['-10', null], ['', null],
  ])('dinheiro %s', (v, esperado) => expect(parseDinheiroCentavos(v)).toBe(esperado));
  it.each([['44', 2640], ['44h', 2640], ['44,5', 2670], ['44:30', 2670], ['2640', 2640], ['40:00', 2400], ['0', null], ['44:75', null], ['x', null], ['99', null], ['299', null], ['300', 300]])(
    'jornada %s', (v, esperado) => expect(parseJornadaMin(v)).toBe(esperado));
  it.each([['6x1', '6x1'], ['6 X 1', '6x1'], ['12x36', '12x36'], ['Personalizada', 'personalizada'], ['5x3', null]])(
    'escala %s', (v, esperado) => expect(parseTipoEscala(v)).toBe(esperado));
  it.each([['Ensino Médio Completo', 'medio'], ['Superior completo', 'superior'], ['Superior incompleto', 'medio'], ['Pós-graduação', 'pos'], ['Fundamental', 'fundamental'], ['??', null]])(
    'escolaridade %s', (v, esperado) => expect(parseEscolaridade(v)).toBe(esperado));
  it.each([['(11) 99999-0000', '11999990000'], ['+55 11 3333-4444', '1133334444'], ['123', null]])(
    'telefone %s', (v, esperado) => expect(parseTelefone(v)).toBe(esperado));
});

describe('cnpj', () => {
  it.each([['11.222.333/0001-81', '11222333000181'], ['11222333000181', '11222333000181'], ['11.222.333/0001-82', null], ['00000000000000', null], ['123', null]])(
    'cnpj %s', (v, esperado) => expect(parseCnpj(v)).toBe(esperado));
  it('formata', () => expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81'));
});

describe('leitura de planilhas', () => {
  it('CSV com ; e BOM', async () => {
    const p = await lerPlanilha(enc('﻿Nome;CPF\r\nAna;111.444.777-35\r\n\r\nBia;52998224725\r\n'), 'x.csv');
    expect(p.colunas).toEqual(['Nome', 'CPF']);
    expect(p.linhas).toEqual([{ Nome: 'Ana', CPF: '111.444.777-35' }, { Nome: 'Bia', CPF: '52998224725' }]);
  });
  it('CSV em Windows-1252 (acentos preservados)', async () => {
    const bytes = Uint8Array.from([...'Nome;Função\r\nJoão;Atendente\r\n'].map((c) => c.charCodeAt(0)));
    const p = await lerPlanilha(bytes, 'x.csv');
    expect(p.colunas).toEqual(['Nome', 'Função']);
    expect(p.linhas[0]).toEqual({ Nome: 'João', Função: 'Atendente' });
  });
  it('XLSX com datas, números e fórmulas', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Equipe');
    ws.addRow(['Nome', 'CPF', 'Admissão', 'Salário']);
    ws.addRow(['Ana', 11144477735, new Date(Date.UTC(2020, 0, 15)), 2500.5]);
    ws.addRow(['Bia', '52998224725', '16/03/2021', { formula: '1000+500', result: 1500 }]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const p = await lerPlanilha(buf, 'equipe.xlsx');
    expect(p.formato).toBe('xlsx');
    expect(p.linhas).toEqual([
      { Nome: 'Ana', CPF: '11144477735', Admissão: '2020-01-15', Salário: '2500.5' },
      { Nome: 'Bia', CPF: '52998224725', Admissão: '16/03/2021', Salário: '1500' },
    ]);
  });
  it('rejeita formato desconhecido, arquivo corrompido, vazio e cabeçalho duplicado', async () => {
    await expect(lerPlanilha(enc('x'), 'a.pdf')).rejects.toThrow(ErroPlanilha);
    await expect(lerPlanilha(enc('não sou um zip'), 'a.xlsx')).rejects.toThrow(/XLSX/);
    await expect(lerPlanilha(enc(''), 'a.csv')).rejects.toThrow(/vazio/);
    await expect(lerPlanilha(enc('a;a\r\n1;2'), 'a.csv')).rejects.toThrow(/mesmo nome/);
  });
});

describe('assistente de mapeamento', () => {
  it('sugere colunas por apelido, ignorando acentos e pontuação', () => {
    const m = sugerirMapeamento(['Nome Completo', 'CPF', 'Data de Admissão', 'Salário Base', 'Carga Horária Semanal', 'Regime de Trabalho', 'Depto']);
    expect(m).toMatchObject({ nome: 'Nome Completo', cpf: 'CPF', admissao: 'Data de Admissão', salario: 'Salário Base', jornada_semanal: 'Carga Horária Semanal', tipo_escala: 'Regime de Trabalho', setor: null });
    expect(camposObrigatoriosSemColuna(m)).toEqual([]);
  });
  it('aponta obrigatórios sem coluna', () => {
    expect(camposObrigatoriosSemColuna(sugerirMapeamento(['Nome', 'CPF']))).toEqual(['admissao', 'salario', 'jornada_semanal', 'tipo_escala']);
  });
});

describe('validação linha a linha', () => {
  const cols = ['Nome', 'CPF', 'Admissão', 'Salário', 'Jornada', 'Escala', 'Escolaridade', 'Setor'];
  const m = sugerirMapeamento(cols);
  const ok = { Nome: 'Ana Souza', CPF: '111.444.777-35', 'Admissão': '01/03/2020', 'Salário': '2.500,00', Jornada: '44', Escala: '6x1', Escolaridade: 'Médio', Setor: 'Loja' };
  it('aceita linha válida e normaliza os campos', () => {
    const r = validarColaboradores([ok], m);
    expect(r.erros).toEqual([]);
    expect(r.validas[0]).toMatchObject({ linha: 2, nome: 'Ana Souza', cpf: '11144477735', admissao: '2020-03-01', salarioCentavos: 250_000, jornadaSemanalMin: 2640, divisor: 220, tipoEscala: '6x1', escolaridade: 'medio', setor: 'Loja' });
    expect(r.validas[0]!.avisos[0]).toMatch(/Divisor não informado/);
  });
  it('reporta cada erro com linha, campo, valor e mensagem; importa as válidas', () => {
    const r = validarColaboradores([
      ok,
      { ...ok, CPF: '123', 'Admissão': '31/02/2020' },
      { ...ok, Nome: 'Dup', CPF: '11144477735' },
      { ...ok, CPF: '52998224725', 'Salário': 'abc', Jornada: '99', Escala: '5x3' },
      Object.fromEntries(cols.map((c) => [c, ''])),
    ], m);
    expect(r.validas).toHaveLength(1);
    expect(r.ignoradas).toBe(1);
    expect(r.erros.map((e) => [e.linha, e.campo])).toEqual([
      [3, 'cpf'], [3, 'admissao'], [4, 'cpf'], [5, 'salario'], [5, 'jornada_semanal'], [5, 'tipo_escala'],
    ]);
    expect(r.erros[2]!.mensagem).toMatch(/linha 2/);
    expect(r.erros[3]!.valor).toBe('abc');
  });
  it('sem colunas obrigatórias mapeadas, bloqueia com mensagem clara', () => {
    const r = validarColaboradores([ok], sugerirMapeamento(['Nome', 'CPF']));
    expect(r.validas).toHaveLength(0);
    expect(r.erros[0]!.mensagem).toMatch(/Data de admissão.*Salário base/);
  });
  it('avisa quando falta escolaridade e valida divisor e folgas informados', () => {
    const cols2 = [...cols, 'Divisor', 'Folgas'];
    const m2 = sugerirMapeamento(cols2);
    const r = validarColaboradores([{ ...ok, Escolaridade: '', Divisor: '210', Folgas: '2' }, { ...ok, CPF: '52998224725', Divisor: '10', Folgas: '9' }], m2);
    expect(r.validas[0]).toMatchObject({ divisor: 210, folgasSemana: 2 });
    expect(r.validas[0]!.avisos.join(' ')).toMatch(/alta renda/);
    expect(r.erros.map((e) => e.campo)).toEqual(['divisor', 'folgas_semana']);
  });
  it('desligamento anterior à admissão é erro', () => {
    const m3 = sugerirMapeamento([...cols, 'Desligamento']);
    const r = validarColaboradores([{ ...ok, Desligamento: '01/01/2019' }], m3);
    expect(r.erros[0]).toMatchObject({ campo: 'desligamento', mensagem: expect.stringMatching(/anterior/) });
  });
  it('exporta erros em CSV abrível no Excel', () => {
    const csv = errosParaCsv([{ linha: 3, campo: 'cpf', valor: '12"3', mensagem: 'CPF inválido' }]);
    expect(csv.startsWith('﻿Linha;Campo;Valor;Problema')).toBe(true);
    expect(csv).toContain('3;cpf;"12""3";"CPF inválido"');
  });
  it('processa 5.000 linhas rapidamente', () => {
    const linhas = Array.from({ length: 5000 }, (_, i) => ({ ...ok, CPF: gerarCpf(i) }));
    const t = performance.now();
    const r = validarColaboradores(linhas, m);
    expect(r.validas).toHaveLength(5000);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

function cpfValido(base: string): string {
  const dv = (s: string) => { let t = 0; for (let i = 0; i < s.length; i++) t += Number(s[i]) * (s.length + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(base);
  return base + d1 + dv(base + d1);
}
function gerarCpf(n: number): string {
  return cpfValido(String(100_000_000 + n).padStart(9, '0'));
}
