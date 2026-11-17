import ExcelJS from 'exceljs';

/** Dados já prontos para imprimir: a montagem (quem trabalha qual turno em cada dia) é feita pelo app; aqui só se desenha. */
export type CelulaEscala = {
  /** Texto curto da célula: código do turno (A, B…), "F" folga, "FÉR" férias, "AFA" afastamento ou vazio. */
  texto: string;
  tipo: 'trabalho' | 'folga' | 'ferias' | 'afastamento' | 'vazio';
  /** Índice do turno (para a cor), só em `trabalho`. */
  indiceTurno?: number;
};
export type DadosEscalaDoc = {
  empresa: { razaoSocial: string; cnpj: string };
  nome: string;
  setor: string | null;
  periodo: { inicio: string; fim: string };
  status: 'rascunho' | 'publicada' | 'substituida';
  versao: number;
  hash: string | null;
  /** Data de geração do arquivo, aaaa-mm-dd. */
  geradoEm: string;
  dias: { data: string; diaSemana: number; feriado: boolean }[];
  linhas: { nome: string; celulas: CelulaEscala[]; diasTrabalhados: number; horasMin: number }[];
  legenda: { codigo: string; descricao: string; indiceTurno: number }[];
  /** Quantas pessoas trabalham em cada dia (mesma ordem de `dias`). */
  cobertura: number[];
};

export const ROTULO_STATUS_ESCALA = { rascunho: 'Rascunho (não publicada)', publicada: 'Publicada', substituida: 'Substituída por nova versão' } as const;
export const SEMANA_CURTA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;
export const SEMANA_NOME = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/** Cores de fundo por turno (claras, boas para imprimir em preto e branco) e dos demais tipos. */
export const CORES_TURNOS = ['#dbeafe', '#ede9fe', '#d1fae5', '#fef3c7', '#ffe4e6', '#e5e7eb'] as const;
export const COR_FOLGA = '#f3f4f6', COR_FERIAS = '#ddd6fe', COR_AFASTAMENTO = '#fecaca';
export const corDaCelula = (c: CelulaEscala): string | null =>
  c.tipo === 'trabalho' ? CORES_TURNOS[(c.indiceTurno ?? 0) % CORES_TURNOS.length]! : c.tipo === 'folga' ? COR_FOLGA : c.tipo === 'ferias' ? COR_FERIAS : c.tipo === 'afastamento' ? COR_AFASTAMENTO : null;

const dataBr = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
export const horasTexto = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
/** Texto seguro para o Excel (não deixa o início virar fórmula). */
const seguro = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function tituloEscala(d: DadosEscalaDoc): string {
  return `${d.nome}${d.setor ? ` · ${d.setor}` : ''}`;
}

export async function gerarEscalaXlsx(d: DadosEscalaDoc): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JornadaCerta'; wb.created = new Date(`${d.geradoEm}T12:00:00Z`);
  const ws = wb.addWorksheet('Escala', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.columns = [{ width: 30 }, ...d.dias.map(() => ({ width: 4.6 })), { width: 8 }, { width: 9 }];
  const cab = ws.getRow(1);
  cab.values = ['Colaborador', ...d.dias.map((x) => Number(x.data.slice(8))), 'Dias', 'Horas'];
  const sem = ws.getRow(2);
  sem.values = ['', ...d.dias.map((x) => SEMANA_NOME[x.diaSemana]!), '', ''];
  for (const r of [cab, sem]) { r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; r.alignment = { horizontal: 'center', vertical: 'middle' }; }
  cab.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  d.dias.forEach((x, i) => { if (x.feriado) for (const r of [cab, sem]) r.getCell(i + 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } }; });

  for (const l of d.linhas) {
    const row = ws.addRow([seguro(l.nome), ...l.celulas.map((c) => c.texto), l.diasTrabalhados, horasTexto(l.horasMin)]);
    row.getCell(1).font = { bold: true };
    l.celulas.forEach((c, i) => {
      const cor = corDaCelula(c), cell = row.getCell(i + 2);
      cell.alignment = { horizontal: 'center' };
      if (cor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(cor) } };
      if (c.tipo === 'trabalho') cell.font = { bold: true };
    });
    row.getCell(d.dias.length + 2).alignment = { horizontal: 'center' }; row.getCell(d.dias.length + 3).alignment = { horizontal: 'center' };
  }
  const cob = ws.addRow(['Pessoas trabalhando', ...d.cobertura, '', '']);
  cob.font = { bold: true }; cob.eachCell((c, n) => { if (n > 1) c.alignment = { horizontal: 'center' }; });
  cob.border = { top: { style: 'thin' } };

  const info = wb.addWorksheet('Informações');
  info.columns = [{ width: 24 }, { width: 70 }];
  info.addRows([
    ['Empresa', d.empresa.razaoSocial], ['CNPJ', d.empresa.cnpj], ['Escala', tituloEscala(d)], ['Período', `${dataBr(d.periodo.inicio)} a ${dataBr(d.periodo.fim)}`],
    ['Situação', ROTULO_STATUS_ESCALA[d.status]], ['Versão', d.versao], ['Código de integridade', d.hash ?? '— (ainda não publicada)'], ['Gerada em', dataBr(d.geradoEm)],
    [], ['Legenda', ''], ...d.legenda.map((l) => [l.codigo, l.descricao] as [string, string]), ['F', 'Folga'], ['FÉR', 'Férias'], ['AFA', 'Afastamento'],
  ]);
  info.getColumn(1).font = { bold: true };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
