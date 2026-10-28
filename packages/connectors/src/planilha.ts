import ExcelJS from 'exceljs';
import Papa from 'papaparse';

export type Linha = Record<string, string>;
export type Planilha = { colunas: string[]; linhas: Linha[]; formato: 'csv' | 'xlsx' };

export const LIMITES = { bytes: 10 * 1024 * 1024, linhas: 20_000, colunas: 60 } as const;

export class ErroPlanilha extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroPlanilha';
  }
}

function decodificarTexto(dados: Uint8Array): string {
  let texto = new TextDecoder('utf-8').decode(dados);
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(dados); // CSV do Excel brasileiro
  return texto.replace(/^﻿/, '');
}

function celulaParaTexto(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10); // datas do Excel chegam como ISO (UTC)
  if (typeof v === 'object') {
    if ('result' in v) return celulaParaTexto(v.result as ExcelJS.CellValue); // fórmula
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v).trim();
}

function montar(cabecalho: string[], corpo: string[][], formato: Planilha['formato']): Planilha {
  const nomes = cabecalho.map((c, i) => c.trim() || `coluna_${i + 1}`);
  if (nomes.length > LIMITES.colunas) throw new ErroPlanilha(`Planilha com mais de ${LIMITES.colunas} colunas.`);
  if (new Set(nomes.map((n) => n.toLowerCase())).size !== nomes.length) throw new ErroPlanilha('Há colunas com o mesmo nome no cabeçalho.');
  if (corpo.length > LIMITES.linhas) throw new ErroPlanilha(`Planilha com mais de ${LIMITES.linhas} linhas.`);
  const linhas = corpo.map((r) => Object.fromEntries(nomes.map((n, i) => [n, (r[i] ?? '').trim()])));
  return { colunas: nomes, linhas, formato };
}

export async function lerPlanilha(dados: Uint8Array, nomeArquivo: string): Promise<Planilha> {
  if (dados.byteLength > LIMITES.bytes) throw new ErroPlanilha('Arquivo maior que 10 MB.');
  const ext = nomeArquivo.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') {
    const r = Papa.parse<string[]>(decodificarTexto(dados), { skipEmptyLines: 'greedy' });
    if (r.data.length === 0) throw new ErroPlanilha('Arquivo vazio.');
    const [cab, ...corpo] = r.data as [string[], ...string[][]];
    return montar(cab, corpo, 'csv');
  }
  if (ext === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(dados as unknown as ArrayBuffer);
    } catch {
      throw new ErroPlanilha('Não foi possível ler o arquivo XLSX. Verifique se não está corrompido ou protegido por senha.');
    }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount === 0) throw new ErroPlanilha('Planilha vazia.');
    const largura = Math.min(ws.columnCount, LIMITES.colunas + 1);
    const matriz: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cels: string[] = [];
      for (let c = 1; c <= largura; c++) cels.push(celulaParaTexto(row.getCell(c).value));
      matriz.push(cels);
    });
    const cheio = matriz.filter((r) => r.some((c) => c !== ''));
    if (cheio.length === 0) throw new ErroPlanilha('Planilha vazia.');
    const [cab, ...corpo] = cheio as [string[], ...string[][]];
    // remove colunas totalmente vazias à direita
    let fim = cab.length;
    while (fim > 0 && cab[fim - 1] === '' && corpo.every((r) => (r[fim - 1] ?? '') === '')) fim--;
    return montar(cab.slice(0, fim), corpo.map((r) => r.slice(0, fim)), 'xlsx');
  }
  throw new ErroPlanilha('Formato não suportado. Envie um arquivo .csv ou .xlsx.');
}
