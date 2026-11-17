import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { COLUNAS_GENERICO, gerarFolhaCsv, gerarFolhaXlsx, LAYOUTS_FOLHA, type FolhaFechada, type LinhaFolha } from '../src';

const linha = (extra: Partial<LinhaFolha> = {}): LinhaFolha => ({
  matricula: 'M001', nome: 'Ana Souza', cargo: 'Caixa', setor: 'Loja', diasTrabalhados: 20, trabalhadasMin: 9600, normaisMin: 9360, extrasMin: 240, adicionalHePercentual: 50,
  noturnasComputadasMin: 90, domingoMin: 480, feriadoMin: 0, domingosTrabalhados: 1, feriadosTrabalhados: 0, faltasMin: 60, diasFerias: 0, diasAfastamento: 2,
  bancoCreditoMin: 120, bancoDebitoMin: 30, bancoPagoMin: 0, bancoSaldoFinalMin: 90, bancoVencidoMin: 45, valorVencidoCentavos: 1688, ...extra,
});
const folha = (linhas: LinhaFolha[] = [linha()]): FolhaFechada => ({ competencia: '2027-02', linhas, avisos: [{ severidade: 'alerta', mensagem: '1 colaborador sem matrícula' }, { severidade: 'info', mensagem: 'Horas pela escala.' }] });
const meta = { empresa: 'Loja Alfa', cnpj: '12.345.678/0001-90', versao: 2, hash: 'ab'.repeat(32), fechadoEm: '2027-03-02T12:00:00Z' };

describe('CSV da folha', () => {
  it('BOM, ponto e vírgula, vírgula decimal, competência MM/AAAA e uma linha por colaborador', () => {
    const csv = gerarFolhaCsv(folha([linha(), linha({ matricula: null, nome: 'Bia', trabalhadasMin: 90 })]));
    expect(csv.startsWith('﻿Competência;Matrícula;Nome;')).toBe(true);
    const ls = csv.trim().split('\r\n');
    expect(ls).toHaveLength(3);
    const c = ls[1]!.split(';');
    expect(c.slice(0, 3)).toEqual(['02/2027', 'M001', 'Ana Souza']);
    expect(c[5]).toBe('20');                         // dias
    expect(c[6]).toBe('160');                         // 9600 min = 160 h
    expect(c[8]).toBe('4');                           // 240 min
    expect(c[12]).toBe('1,5');                        // 90 min computadas
    expect(c.at(-3)).toBe('16,88');                   // R$ 16,88 (as colunas do ponto vêm depois e valem 0 na escala)
    expect(c.slice(-2)).toEqual(['0', '0']);
    expect(ls[2]!.split(';')[1]).toBe('');            // sem matrícula: célula vazia
    expect(ls[2]!.split(';')[6]).toBe('1,5');
    expect(ls[0]!.split(';')).toHaveLength(COLUNAS_GENERICO.length);
    expect(ls[1]!.split(';')).toHaveLength(COLUNAS_GENERICO.length);
  });
  it('protege contra fórmula e escapa aspas e separadores', () => {
    const csv = gerarFolhaCsv(folha([linha({ nome: '=CMD("x")', cargo: 'A;B "C"', setor: '+55 11' })]));
    const l = csv.trim().split('\r\n')[1]!;
    expect(l).toContain(`"'=CMD(""x"")"`);
    expect(l).toContain('"A;B ""C"""');
    expect(l).toContain("'+55 11");
  });
  it('mês sem linhas gera só o cabeçalho', () => {
    expect(gerarFolhaCsv(folha([])).trim().split('\r\n')).toHaveLength(1);
  });
  it('o layout genérico está catalogado', () => {
    expect(LAYOUTS_FOLHA.map((l) => l.id)).toEqual(['generico']);
  });
});

describe('XLSX da folha', () => {
  it('abas Folha, Fechamento e Avisos; números de verdade (não texto); totais em fórmula', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarFolhaXlsx(folha([linha(), linha({ nome: 'Bia', matricula: 'M002', trabalhadasMin: 600 })]), meta)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Folha', 'Fechamento', 'Avisos']);
    const ws = wb.getWorksheet('Folha')!;
    expect(ws.getRow(1).getCell(3).value).toBe('Nome');
    expect(ws.getRow(2).getCell(7).value).toBe(160);                    // horas trabalhadas, numérico
    expect(ws.getRow(3).getCell(7).value).toBe(10);
    expect(ws.getRow(2).getCell(24).value).toBe(16.88);
    const total = ws.getRow(4);
    expect(total.getCell(3).value).toBe('TOTAL');
    expect((total.getCell(7).value as { formula: string }).formula).toBe('SUM(G2:G3)');
    expect(ws.getColumn(7).numFmt).toBe('0.00');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    const fech = wb.getWorksheet('Fechamento')!;
    const mapa = new Map(fech.getSheetValues().slice(2).map((r) => [(r as unknown[])[1], (r as unknown[])[2]]));
    expect(mapa.get('Empresa')).toBe('Loja Alfa');
    expect(mapa.get('Competência')).toBe('02/2027');
    expect(mapa.get('Versão do fechamento')).toBe(2);
    expect(fech.getCell('B5').numFmt ?? 'General').not.toContain('yyyy');   // a versão é número, não data
    expect(fech.getCell('B6').numFmt).toBe('dd/mm/yyyy hh:mm');             // a data do fechamento tem formato de data
    expect(mapa.get('Código de integridade (SHA-256)')).toBe(meta.hash);
    const av = wb.getWorksheet('Avisos')!;
    expect(av.getRow(2).values).toEqual([undefined, 'Atenção', '1 colaborador sem matrícula']);
    expect(av.getRow(3).getCell(1).value).toBe('Informação');
  });
  it('texto que parece fórmula fica como texto', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarFolhaXlsx(folha([linha({ nome: '=1+1' })]), meta)) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Folha')!.getRow(2).getCell(3).value).toBe("'=1+1");
  });
  it('mês vazio gera a planilha sem linha de total e com "Nenhum aviso"', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarFolhaXlsx({ competencia: '2027-02', linhas: [], avisos: [] }, meta)) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Folha')!.rowCount).toBe(1);
    expect(wb.getWorksheet('Avisos')!.getRow(2).getCell(2).value).toBe('Nenhum aviso.');
  });
});

describe('fechamento pelo ponto no arquivo', () => {
  it('as colunas do ponto ficam no fim e saem preenchidas; o resumo diz de onde vêm as horas', async () => {
    const f = { ...folha([linha({ faltasPontoMin: 480, diasSemMarcacao: 2 })]), origem: 'ponto' as const, semMarcacao: 'falta' as const };
    const c = gerarFolhaCsv(f).trim().split('\r\n');
    expect(c[0]!.split(';').slice(-2)).toEqual(['Faltas pelo ponto (horas)', 'Dias previstos sem marcação']);
    expect(c[1]!.split(';').slice(-2)).toEqual(['8', '2']);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await gerarFolhaXlsx(f, meta)) as unknown as ArrayBuffer);
    const origem = wb.getWorksheet('Fechamento')!.getRows(2, 12)!.map((r) => [r.getCell(1).value, r.getCell(2).value]).find(([k]) => k === 'Origem das horas')!;
    expect(String(origem[1])).toMatch(/Ponto apurado.*descontado como falta/);
  });
  it('fechamento antigo (sem origem) continua saindo como escala', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await gerarFolhaXlsx(folha([linha()]), meta)) as unknown as ArrayBuffer);
    const origem = wb.getWorksheet('Fechamento')!.getRows(2, 12)!.map((r) => [r.getCell(1).value, r.getCell(2).value]).find(([k]) => k === 'Origem das horas')!;
    expect(String(origem[1])).toMatch(/Escala publicada/);
  });
});
