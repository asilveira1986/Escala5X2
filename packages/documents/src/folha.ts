import ExcelJS from 'exceljs';

/** Estrutura do fechamento mensal (idêntica à de `@jc/servicos`, repetida aqui para o pacote não depender dele). */
export type LinhaFolha = {
  matricula: string | null; nome: string; cargo: string | null; setor: string | null;
  diasTrabalhados: number; trabalhadasMin: number; normaisMin: number; extrasMin: number; adicionalHePercentual: number;
  noturnasComputadasMin: number; domingoMin: number; feriadoMin: number; domingosTrabalhados: number; feriadosTrabalhados: number;
  faltasMin: number; diasFerias: number; diasAfastamento: number;
  /** Só nos fechamentos pelo ponto (ausentes nos antigos). */
  diasSemMarcacao?: number; faltasPontoMin?: number;
  bancoCreditoMin: number; bancoDebitoMin: number; bancoPagoMin: number; bancoSaldoFinalMin: number; bancoVencidoMin: number; valorVencidoCentavos: number;
};
export type FolhaFechada = {
  competencia: string;                                   // AAAA-MM
  /** De onde vêm as horas: escala publicada (previstas) ou ponto (apuradas). Fechamentos antigos não têm: são da escala. */
  origem?: 'escala' | 'ponto';
  semMarcacao?: 'escala' | 'falta';
  linhas: LinhaFolha[];
  avisos: Array<{ severidade: string; mensagem: string }>;
};
export type MetaFolha = { empresa: string; cnpj?: string; versao: number; hash: string; fechadoEm: string };

export type LayoutFolha = 'generico';
export const LAYOUTS_FOLHA: Array<{ id: LayoutFolha; nome: string; descricao: string }> = [
  { id: 'generico', nome: 'Planilha genérica', descricao: 'Uma linha por colaborador, horas em decimal (vírgula), pronta para conferir ou mapear no sistema de folha.' },
];

const horas = (min: number): number => Math.round((min / 60) * 100) / 100;
const reais = (c: number): number => Math.round(c) / 100;
const competenciaBr = (c: string): string => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

export const COLUNAS_GENERICO: Array<{ titulo: string; largura: number; valor: (l: LinhaFolha, comp: string) => string | number; formato?: '0.00' | '0' | '"R$" #,##0.00' }> = [
  { titulo: 'Competência', largura: 13, valor: (_l, c) => competenciaBr(c) },
  { titulo: 'Matrícula', largura: 13, valor: (l) => l.matricula ?? '' },
  { titulo: 'Nome', largura: 32, valor: (l) => l.nome },
  { titulo: 'Cargo', largura: 20, valor: (l) => l.cargo ?? '' },
  { titulo: 'Setor', largura: 18, valor: (l) => l.setor ?? '' },
  { titulo: 'Dias trabalhados', largura: 12, valor: (l) => l.diasTrabalhados, formato: '0' },
  { titulo: 'Horas trabalhadas', largura: 12, valor: (l) => horas(l.trabalhadasMin), formato: '0.00' },
  { titulo: 'Horas normais', largura: 12, valor: (l) => horas(l.normaisMin), formato: '0.00' },
  { titulo: 'Horas extras', largura: 12, valor: (l) => horas(l.extrasMin), formato: '0.00' },
  { titulo: '% adicional hora extra', largura: 12, valor: (l) => l.adicionalHePercentual, formato: '0' },
  { titulo: 'Horas em domingos', largura: 12, valor: (l) => horas(l.domingoMin), formato: '0.00' },
  { titulo: 'Horas em feriados', largura: 12, valor: (l) => horas(l.feriadoMin), formato: '0.00' },
  { titulo: 'Adicional noturno (horas computadas)', largura: 16, valor: (l) => horas(l.noturnasComputadasMin), formato: '0.00' },
  { titulo: 'Domingos trabalhados', largura: 12, valor: (l) => l.domingosTrabalhados, formato: '0' },
  { titulo: 'Feriados trabalhados', largura: 12, valor: (l) => l.feriadosTrabalhados, formato: '0' },
  { titulo: 'Faltas (horas)', largura: 11, valor: (l) => horas(l.faltasMin), formato: '0.00' },
  { titulo: 'Dias de férias', largura: 10, valor: (l) => l.diasFerias, formato: '0' },
  { titulo: 'Dias de afastamento', largura: 12, valor: (l) => l.diasAfastamento, formato: '0' },
  { titulo: 'Banco: créditos no mês (h)', largura: 14, valor: (l) => horas(l.bancoCreditoMin), formato: '0.00' },
  { titulo: 'Banco: débitos no mês (h)', largura: 14, valor: (l) => horas(l.bancoDebitoMin), formato: '0.00' },
  { titulo: 'Banco: horas pagas no mês (h)', largura: 14, valor: (l) => horas(l.bancoPagoMin), formato: '0.00' },
  { titulo: 'Banco: saldo final (h)', largura: 14, valor: (l) => horas(l.bancoSaldoFinalMin), formato: '0.00' },
  { titulo: 'Banco: vencido a pagar (h)', largura: 14, valor: (l) => horas(l.bancoVencidoMin), formato: '0.00' },
  { titulo: 'Valor estimado do vencido (R$)', largura: 16, valor: (l) => reais(l.valorVencidoCentavos), formato: '"R$" #,##0.00' },
  // colunas do fechamento pelo ponto, no fim para não deslocar as demais em quem já mapeou o arquivo (0 nos fechamentos pela escala)
  { titulo: 'Faltas pelo ponto (horas)', largura: 13, valor: (l) => horas(l.faltasPontoMin ?? 0), formato: '0.00' },
  { titulo: 'Dias previstos sem marcação', largura: 13, valor: (l) => l.diasSemMarcacao ?? 0, formato: '0' },
];

/** Texto de célula seguro para o Excel: não deixa o início virar fórmula (=, +, -, @). */
const texto = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const campoCsv = (v: string | number): string => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : texto(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV para Excel pt-BR e para importadores de folha: `;`, números com vírgula, UTF-8 com BOM. */
export function gerarFolhaCsv(f: FolhaFechada): string {
  const linhas = [COLUNAS_GENERICO.map((c) => campoCsv(c.titulo)).join(';'), ...f.linhas.map((l) => COLUNAS_GENERICO.map((c) => campoCsv(c.valor(l, f.competencia))).join(';'))];
  return `﻿${linhas.join('\r\n')}\r\n`;
}

export async function gerarFolhaXlsx(f: FolhaFechada, meta: MetaFolha): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JornadaCerta'; wb.created = new Date(meta.fechadoEm);
  const cab = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6B63' } };
    row.alignment = { wrapText: true, vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 3 }];
  };

  const ws = wb.addWorksheet('Folha');
  ws.columns = COLUNAS_GENERICO.map((c) => ({ header: c.titulo, width: c.largura }));
  for (const l of f.linhas) ws.addRow(COLUNAS_GENERICO.map((c) => { const v = c.valor(l, f.competencia); return typeof v === 'string' ? texto(v) : v; }));
  COLUNAS_GENERICO.forEach((c, i) => { if (c.formato) ws.getColumn(i + 1).numFmt = c.formato; });
  cab(ws);
  // totais das colunas numéricas, em fórmula (acompanha qualquer ajuste feito na planilha)
  if (f.linhas.length > 0) {
    const total = ws.addRow(COLUNAS_GENERICO.map((c, i) => (i === 2 ? 'TOTAL' : c.formato && c.titulo !== '% adicional hora extra' ? { formula: `SUM(${ws.getColumn(i + 1).letter}2:${ws.getColumn(i + 1).letter}${f.linhas.length + 1})` } : '')));
    total.font = { bold: true };
  }

  const resumo = wb.addWorksheet('Fechamento');
  resumo.columns = [{ header: 'Item', width: 28 }, { header: 'Valor', width: 70 }];
  resumo.addRows([
    ['Empresa', meta.empresa], ['CNPJ', meta.cnpj ?? ''], ['Competência', competenciaBr(f.competencia)], ['Versão do fechamento', meta.versao],
    ['Fechado em', new Date(meta.fechadoEm)], ['Código de integridade (SHA-256)', meta.hash], ['Colaboradores', f.linhas.length],
    ['Origem das horas', f.origem === 'ponto'
      ? `Ponto apurado (marcações do relógio). Dia previsto sem marcação: ${f.semMarcacao === 'falta' ? 'descontado como falta' : 'contado como previsto na escala'}.`
      : 'Escala publicada (horas previstas, não apuradas pelo ponto)'],
    ['Aviso', 'Confira faltas, horas extras e adicionais antes de importar na folha; as regras de cada sindicato podem mudar o cálculo.'],
  ]);
  resumo.getCell('B6').numFmt = 'dd/mm/yyyy hh:mm';   // linha "Fechado em"
  cab(resumo);

  const av = wb.addWorksheet('Avisos');
  av.columns = [{ header: 'Gravidade', width: 12 }, { header: 'Aviso', width: 110 }];
  for (const a of f.avisos) av.addRow([a.severidade === 'bloqueio' ? 'Bloqueio' : a.severidade === 'alerta' ? 'Atenção' : 'Informação', texto(a.mensagem)]);
  if (f.avisos.length === 0) av.addRow(['', 'Nenhum aviso.']);
  cab(av);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
