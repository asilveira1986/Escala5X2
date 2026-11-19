import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { corDaCelula, gerarEscalaPdf, gerarEscalaXlsx, horasTexto, tituloEscala, type CelulaEscala, type DadosEscalaDoc } from '../src';

const dia = (i: number) => new Date(Date.parse('2027-03-01T00:00:00Z') + i * 86_400_000);
const dias = Array.from({ length: 31 }, (_, i) => ({ data: dia(i).toISOString().slice(0, 10), diaSemana: dia(i).getUTCDay(), feriado: i === 20 }));
const celulas = (n: number): CelulaEscala[] => dias.map((d, i) => (d.diaSemana === 0 || d.diaSemana === 6 ? { texto: 'F', tipo: 'folga' } : i >= 8 && i <= 12 && n === 0 ? { texto: 'FÉR', tipo: 'ferias' } : { texto: n % 2 ? 'B' : 'A', tipo: 'trabalho', indiceTurno: n % 2 }));
const dados = (pessoas = 3, extra: Partial<DadosEscalaDoc> = {}): DadosEscalaDoc => ({
  empresa: { razaoSocial: 'Loja Alfa Ltda', cnpj: '12.345.678/0001-90' }, nome: 'Escala de março', setor: 'Loja', periodo: { inicio: '2027-03-01', fim: '2027-03-31' },
  status: 'publicada', versao: 2, hash: 'a'.repeat(64), geradoEm: '2027-02-25', dias,
  linhas: Array.from({ length: pessoas }, (_, n) => ({ nome: `Pessoa ${String(n).padStart(2, '0')}`, celulas: celulas(n), diasTrabalhados: 18, horasMin: 18 * 480 })),
  legenda: [{ codigo: 'A', descricao: 'Manhã 08:00–17:00 (intervalo 1h)', indiceTurno: 0 }, { codigo: 'B', descricao: 'Tarde 14:00–23:00 (intervalo 1h)', indiceTurno: 1 }],
  cobertura: dias.map((d) => (d.diaSemana === 0 || d.diaSemana === 6 ? 0 : pessoas)), ...extra,
});
const paginas = (pdf: Uint8Array) => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe('escala em PDF', () => {
  it('gera um PDF de verdade (A4 paisagem), com várias páginas quando a equipe é grande', async () => {
    const pequeno = await gerarEscalaPdf(dados(5));
    expect(Buffer.from(pequeno.slice(0, 5)).toString()).toBe('%PDF-');
    expect(paginas(pequeno)).toBe(1);
    const grande = await gerarEscalaPdf(dados(70));
    expect(paginas(grande)).toBeGreaterThan(1);
    expect(grande.length).toBeGreaterThan(pequeno.length);
  }, 30_000); // gera dois PDFs (5 e 70 pessoas); no runner do CI leva ~11 s, acima dos 5 s padrão
  it('rascunho e escala sem hash também geram, e mês curto (28 dias) funciona', async () => {
    const r = await gerarEscalaPdf(dados(3, { status: 'rascunho', hash: null, dias: dias.slice(0, 28), cobertura: Array(28).fill(2), linhas: [{ nome: 'Ana', celulas: celulas(1).slice(0, 28), diasTrabalhados: 20, horasMin: 9600 }] }));
    expect(Buffer.from(r.slice(0, 5)).toString()).toBe('%PDF-');
  });
});

describe('escala em Excel', () => {
  const ler = async (d: DadosEscalaDoc) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await gerarEscalaXlsx(d)) as unknown as ArrayBuffer); return wb; };
  it('grade pessoa × dia com cores, totais, linha de cobertura e aba de informações com legenda', async () => {
    const wb = await ler(dados(3));
    const ws = wb.getWorksheet('Escala')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Colaborador');
    expect(ws.getRow(1).getCell(2).value).toBe(1);                       // dia 1
    expect(ws.getRow(2).getCell(2).value).toBe('seg');                  // 01/03/2027 é segunda
    expect(ws.getRow(3).getCell(1).value).toBe('Pessoa 00');
    expect(ws.getRow(3).getCell(2).value).toBe('A');
    expect(ws.getRow(3).getCell(10).value).toBe('FÉR');                  // férias (dias 9 a 13)
    expect(ws.getRow(3).getCell(7).value).toBe('F');                     // sábado
    expect((ws.getRow(3).getCell(2).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFDBEAFE');
    expect((ws.getRow(3).getCell(10).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFDDD6FE');
    expect(ws.getRow(3).getCell(33).value).toBe(18);                     // dias trabalhados
    expect(ws.getRow(3).getCell(34).value).toBe('144h');                 // 18 × 8h
    const cob = ws.getRow(6);
    expect(cob.getCell(1).value).toBe('Pessoas trabalhando');
    expect(cob.getCell(2).value).toBe(3);
    expect(cob.getCell(7).value).toBe(0);
    const info = wb.getWorksheet('Informações')!;
    const linhas = new Map(info.getRows(1, 20)!.map((r) => [String(r.getCell(1).value), r.getCell(2).value]));
    expect(linhas.get('Empresa')).toBe('Loja Alfa Ltda');
    expect(linhas.get('Período')).toBe('01/03/2027 a 31/03/2027');
    expect(linhas.get('Situação')).toBe('Publicada');
    expect(String(linhas.get('Código de integridade'))).toBe('a'.repeat(64));
    expect(linhas.get('A')).toBe('Manhã 08:00–17:00 (intervalo 1h)');
    expect(linhas.get('FÉR')).toBe('Férias');
  });
  it('rascunho diz que ainda não foi publicada; nome que parece fórmula é neutralizado', async () => {
    const wb = await ler(dados(1, { status: 'rascunho', hash: null, linhas: [{ nome: '=1+1', celulas: celulas(1), diasTrabalhados: 1, horasMin: 60 }] }));
    expect(wb.getWorksheet('Escala')!.getRow(3).getCell(1).value).toBe("'=1+1");
    const info = wb.getWorksheet('Informações')!;
    expect(String(info.getRow(7).getCell(2).value)).toMatch(/ainda não publicada/);
    expect(info.getRow(5).getCell(2).value).toBe('Rascunho (não publicada)');
  });
});

describe('auxiliares', () => {
  it('cor por tipo, horas e título', () => {
    expect(corDaCelula({ texto: 'A', tipo: 'trabalho', indiceTurno: 0 })).toBe('#dbeafe');
    expect(corDaCelula({ texto: 'A', tipo: 'trabalho', indiceTurno: 7 })).toBe('#ede9fe');                 // volta ao começo da paleta
    expect(corDaCelula({ texto: '', tipo: 'vazio' })).toBeNull();
    expect([horasTexto(480), horasTexto(450), horasTexto(0)]).toEqual(['8h', '7h30', '0h']);
    expect(tituloEscala(dados())).toBe('Escala de março · Loja');
    expect(tituloEscala(dados(1, { setor: null }))).toBe('Escala de março');
  });
});
