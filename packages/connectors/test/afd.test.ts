import { describe, expect, it } from 'vitest';
import { decodificarAfd, instanteDeParedeSP, lerAfd } from '../src';

const AGORA = new Date('2027-03-05T12:00:00Z');
const CNPJ = '11222333000181';
const CPF_A = '52998224725', CPF_B = '11144477735';
const PIS_A = '12345678919';                         // PIS válido (dígito verificador conferido)
const pad = (n: number, t: number) => String(n).padStart(t, '0');

// ---- gerador de arquivos nos dois leiautes
const cab1510 = () => `000000000${'1'}1${CNPJ}${' '.repeat(12)}${'EMPRESA TESTE LTDA'.padEnd(150)}${'RUA X'.padEnd(100)}01022027280220271503202709` + '00';
const cab671 = () => `000000000${'1'}1${CNPJ}${'0'.repeat(14)}${'EMPRESA TESTE LTDA'.padEnd(150)}${'0'.repeat(17)}2027-02-01-----`.slice(0, 220);
const m1510 = (nsr: number, dd: string, mm: string, aaaa: string, hh: string, mi: string, pis = PIS_A) => `${pad(nsr, 9)}3${dd}${mm}${aaaa}${hh}${mi}0${pis}`;
const m671 = (nsr: number, iso: string, cpf = CPF_A, tipo = '3') => `${pad(nsr, 9)}${tipo}${iso}0${cpf}ABCD`;
const trailer1510 = (t3: number) => `999999999${'9'.padStart(1, '9')}`.slice(0, 0) + `000000000${'9'}${pad(0, 9)}${pad(t3, 9)}${pad(0, 9)}${pad(0, 9)}`;
const arq = (...ls: string[]) => ls.join('\r\n') + '\r\n';

describe('AFD Portaria 1.510 (PIS, data ddmmaaaa e hora hhmm)', () => {
  const texto = arq(cab1510(), m1510(1, '01', '02', '2027', '08', '00'), m1510(2, '01', '02', '2027', '12', '00'), '000000003' + '5' + '01022027' + '0800' + 'I' + PIS_A.padStart(12, '0') + 'Fulano'.padEnd(52), trailer1510(2));
  const r = lerAfd(texto, { agora: AGORA });
  it('lê as marcações, o empregador, o período e ignora outros registros', () => {
    expect(r.valido).toBe(true);
    expect(r.dialeto).toBe('portaria_1510');
    expect(r.empregador).toEqual({ tipoDocumento: 'cnpj', documento: CNPJ });
    expect(r.erros).toEqual([]);
    expect(r.marcacoes.map((m) => [m.nsr, m.dataLocal, m.horaLocal, m.tipoIdentificador, m.identificador])).toEqual([[1, '2027-02-01', '08:00', 'pis', PIS_A], [2, '2027-02-01', '12:00', 'pis', PIS_A]]);
    expect(r.marcacoes[0]!.momento).toBe('2027-02-01T11:00:00.000Z');          // 08:00 em São Paulo (-03:00)
    expect(r.resumo).toMatchObject({ linhas: 5, marcacoes: 2, identificadores: 1, primeiraData: '2027-02-01', ultimaData: '2027-02-01', trailer: true, ignoradosPorTipo: { '5': 1 } });
    expect(r.avisos).toEqual([]);                                              // trailer confere com as 2 marcações
  });
  it('trailer que não bate com a quantidade de marcações vira aviso (arquivo editado ou cortado)', () => {
    const t = arq(cab1510(), m1510(1, '01', '02', '2027', '08', '00'), trailer1510(5));
    expect(lerAfd(t, { agora: AGORA }).avisos.join(' ')).toMatch(/trailer informa 5 marcações e o arquivo traz 1/);
  });
  it('sem trailer: aviso de arquivo possivelmente cortado', () => {
    expect(lerAfd(arq(cab1510(), m1510(1, '01', '02', '2027', '08', '00')), { agora: AGORA }).avisos.join(' ')).toMatch(/não tem a linha final/);
  });
});

describe('AFD Portaria 671 (CPF, data e hora ISO 8601 com fuso)', () => {
  const texto = arq(cab671(), m671(1, '2027-02-01T08:00:00-0300'), m671(2, '2027-02-01T12:03:00-03:00', CPF_B), m671(3, '2027-02-01T16:00:00Z', CPF_A, '7'));
  const r = lerAfd(texto, { agora: AGORA });
  it('lê tipos 3 e 7, converte o fuso e valida o CPF', () => {
    expect(r.dialeto).toBe('portaria_671');
    expect(r.erros).toEqual([]);
    expect(r.marcacoes.map((m) => [m.tipoRegistro, m.dataLocal, m.horaLocal, m.identificador, m.tipoIdentificador])).toEqual([
      ['3', '2027-02-01', '08:00', CPF_A, 'cpf'], ['3', '2027-02-01', '12:03', CPF_B, 'cpf'], ['7', '2027-02-01', '13:00', CPF_A, 'cpf']]);
    expect(r.resumo.identificadores).toBe(2);
  });
  it('marcação repetida (mesma pessoa e instante, ainda que em fuso diferente) conta como duplicada, não como nova', () => {
    const d = lerAfd(arq(cab671(), m671(1, '2027-02-01T08:00:00-0300'), m671(2, '2027-02-01T11:00:00Z', CPF_A, '7')), { agora: AGORA });   // 08:00-0300 e 11:00Z são o mesmo instante
    expect(d.resumo.duplicadasNoArquivo).toBe(1);
    expect(d.marcacoes).toHaveLength(1);
    expect(r.resumo.duplicadasNoArquivo).toBe(0);
  });
  it('um REP em outro fuso (Manaus, -04:00) é convertido para o horário de São Paulo', () => {
    const x = lerAfd(arq(cab671(), m671(1, '2027-02-01T07:00:00-0400')), { agora: AGORA });
    expect(x.marcacoes[0]).toMatchObject({ momento: '2027-02-01T11:00:00.000Z', horaLocal: '08:00' });
  });
});

describe('validações: nunca adivinhar', () => {
  it('arquivo que não é AFD é recusado logo na primeira linha, sem ler o resto', () => {
    const r = lerAfd('Nome;CPF;Salario\r\nAna;1;2\r\n', { agora: AGORA });
    expect(r.valido).toBe(false);
    expect(r.erros[0]).toMatchObject({ linha: 1, mensagem: expect.stringMatching(/não é um cabeçalho de AFD/) });
    expect(r.marcacoes).toEqual([]);
    expect(lerAfd('', { agora: AGORA }).erros[0]!.mensagem).toMatch(/vazio/);
  });
  it('linha ruim vira erro com o número da linha e o restante do arquivo continua sendo lido', () => {
    const t = arq(cab1510(), m1510(1, '01', '02', '2027', '08', '00'), m1510(2, '31', '02', '2027', '08', '00'), m1510(3, '01', '02', '2027', '25', '00'), m1510(4, '01', '02', '2027', '09', '00', '12345678901'), m1510(5, '01', '02', '2027', '12', '00'), 'lixo qualquer', '000000007' + '3' + 'xx');
    const r = lerAfd(t, { agora: AGORA });
    expect(r.marcacoes.map((m) => m.nsr)).toEqual([1, 5]);
    expect(r.erros.map((e) => [e.linha, e.mensagem.replace(/\.$/, '')])).toEqual([
      [3, 'Data ou hora inválida na marcação'], [4, 'Data ou hora inválida na marcação'], [5, 'PIS da marcação inválido'], [7, 'Linha fora do leiaute do AFD (NSR e tipo de registro)'], [8, 'Marcação tipo 3 fora dos leiautes conhecidos (Portaria 1.510 ou 671)'],
    ]);
  });
  it('os erros nunca carregam CPF ou PIS no texto', () => {
    const r = lerAfd(arq(cab671(), m671(1, '2027-02-01T08:00:00-0300', '12345678900')), { agora: AGORA });
    expect(r.erros[0]!.mensagem).toMatch(/CPF/);
    expect(JSON.stringify(r.erros)).not.toContain('12345678900');
    expect(r.erros[0]!.trecho).toBe('0000000013…');                            // só NSR e tipo
  });
  it('não mistura os dois leiautes no mesmo arquivo', () => {
    const r = lerAfd(arq(cab1510(), m1510(1, '01', '02', '2027', '08', '00'), m671(2, '2027-02-01T09:00:00-0300')), { agora: AGORA });
    expect(r.dialeto).toBe('portaria_1510');
    expect(r.erros).toEqual([expect.objectContaining({ linha: 3, mensagem: expect.stringMatching(/mistura/) })]);
  });
  it('data no futuro e data anterior a 2000 são erros', () => {
    const r = lerAfd(arq(cab1510(), m1510(1, '01', '06', '2027', '08', '00'), m1510(2, '01', '01', '1999', '08', '00')), { agora: AGORA });
    expect(r.erros.map((e) => e.mensagem)).toEqual(['Marcação com data no futuro.', 'Marcação com data anterior a 2000.']);
    expect(r.valido).toBe(false);
  });
  it('arquivo sem marcações avisa e não é válido', () => {
    const r = lerAfd(arq(cab1510(), trailer1510(0)), { agora: AGORA });
    expect(r.valido).toBe(false);
    expect(r.avisos.join(' ')).toMatch(/nenhuma marcação/);
  });
  it('limita a quantidade de erros guardados (arquivo todo errado não estoura a memória)', () => {
    const r = lerAfd(arq(cab1510(), ...Array.from({ length: 500 }, (_, i) => m1510(i + 1, '31', '02', '2027', '08', '00'))), { agora: AGORA });
    expect(r.erros).toHaveLength(200);
  });
  it('NSR repetido é avisado', () => {
    const r = lerAfd(arq(cab1510(), m1510(1, '01', '02', '2027', '08', '00'), m1510(1, '01', '02', '2027', '12', '00')), { agora: AGORA });
    expect(r.avisos).toContain('Há NSR repetido no arquivo.');
  });
});

describe('fuso de São Paulo e codificação', () => {
  it('converte hora de parede em instante, inclusive no horário de verão que existiu até 2019', () => {
    expect(new Date(instanteDeParedeSP(2027, 2, 1, 8, 0)!).toISOString()).toBe('2027-02-01T11:00:00.000Z');
    expect(new Date(instanteDeParedeSP(2018, 12, 10, 8, 0)!).toISOString()).toBe('2018-12-10T10:00:00.000Z');   // -02:00 no verão de 2018
    expect(instanteDeParedeSP(2018, 11, 4, 0, 30)).toBeNull();                                                  // 00:00–01:00 não existiu (salto)
  });
  it('decodifica UTF-8 (com ou sem BOM) e cai para Latin-1', () => {
    const utf8 = new TextEncoder().encode('﻿EMPRESA AÇÚCAR');
    expect(decodificarAfd(utf8)).toBe('EMPRESA AÇÚCAR');
    const latin1 = Uint8Array.from([0x45, 0x4d, 0x50, 0x20, 0xc7, 0xc3, 0x4f]);                              // "EMP ÇÃO" em ISO-8859-1
    expect(decodificarAfd(latin1)).toBe('EMP ÇÃO');
  });
  it('um arquivo grande é lido rápido', () => {
    const linhas = Array.from({ length: 100_000 }, (_, i) => m1510(i + 1, '01', '02', '2027', pad(8 + (i % 10), 2), pad(i % 60, 2)));
    const t0 = performance.now();
    const r = lerAfd(arq(cab1510(), ...linhas), { agora: AGORA });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.resumo.marcacoes + r.resumo.duplicadasNoArquivo).toBe(100_000);
  });
});
