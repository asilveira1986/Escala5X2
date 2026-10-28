import ExcelJS from 'exceljs';
import { corValida, MARCA_PADRAO, type DadosRelatorio } from './tipos';
import { ROTULO_CENARIO, ROTULO_CLASSIFICACAO, ROTULO_EXCECAO } from './formatar';

const FMT_MOEDA = '"R$" #,##0.00';
const aData = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

export async function gerarRelatorioXlsx(dados: DadosRelatorio): Promise<Uint8Array> {
  const cor = (corValida(dados.marca.corPrimaria) ? dados.marca.corPrimaria : MARCA_PADRAO.corPrimaria).slice(1).toUpperCase();
  const wb = new ExcelJS.Workbook();
  wb.creator = dados.marca.nome;
  wb.created = aData(dados.geradoEm);
  const { diagnostico: d, empresa } = dados;

  const cabecalho = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${cor}` } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [{ header: 'Indicador', width: 44 }, { header: 'Valor', width: 28 }];
  const c = d.resumo.porClassificacao;
  resumo.addRows([
    ['Empresa', empresa.razaoSocial], ['CNPJ', empresa.cnpj], ['Data de referência', aData(d.dataReferencia)], ['Gerado por', dados.marca.nome],
    ['Fase 1 — início', aData(d.fases.f1Inicio)], ['Fase 1 — fim (exclusivo)', aData(d.fases.f1Fim)], ['Fase 2 — início', aData(d.fases.f2Inicio)],
    ['Colaboradores analisados', d.resumo.total], ['Adequados', c.adequado], ['Adequar na fase 1', c.adequacao_f1], ['Adequar na fase 2', c.adequacao_f2], ['Exceções', c.excecao],
    ['Folha mensal', d.resumo.folhaMensalCentavos / 100], ['Déficit semanal fase 1 (horas)', d.resumo.horasPerdidasF1Min / 60], ['Déficit semanal fase 2 (horas)', d.resumo.horasPerdidasF2Min / 60],
    ['FTE fase 1', d.resumo.fteF1], ['FTE fase 2', d.resumo.fteF2],
    ['Aviso', 'Estimativa para planejamento; não substitui parecer jurídico ou contábil. Nenhum cenário considera redução de salário.'],
  ]);
  resumo.eachRow((row) => {
    const rotulo = String(row.getCell(1).value ?? '');
    const celula = row.getCell(2);
    if (celula.value instanceof Date) celula.numFmt = 'dd/mm/yyyy';
    else if (rotulo === 'Folha mensal') celula.numFmt = FMT_MOEDA;
    else if (rotulo.startsWith('Déficit') || rotulo.startsWith('FTE')) celula.numFmt = '0.00';
  });
  cabecalho(resumo);

  const setores = wb.addWorksheet('Setores');
  setores.columns = [
    { header: 'Setor', width: 24 }, { header: 'Turno', width: 14 }, { header: 'Colaboradores', width: 15 },
    { header: 'Afetados F1', width: 12 }, { header: 'Afetados F2', width: 12 }, { header: 'Déficit F1 (h/sem)', width: 18 }, { header: 'Déficit F2 (h/sem)', width: 18 },
    { header: 'FTE F1', width: 10 }, { header: 'FTE F2', width: 10 }, { header: 'Salário médio', width: 16 }, { header: 'Valor/hora médio F2', width: 20 },
    ...['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((h) => ({ header: `Déficit F2 ${h} (h)`, width: 16 })),
  ];
  for (const g of d.grupos) {
    setores.addRow([g.setor ?? '', g.turno ?? '', g.colaboradores, g.afetadosF1, g.afetadosF2, g.horasPerdidasF1Min / 60, g.horasPerdidasF2Min / 60, g.fteF1, g.fteF2,
      g.salarioMedioCentavos / 100, g.valorHoraMedioF2Centavos / 100, ...g.deficitPorDiaSemanaF2Min.map((m) => m / 60)]);
  }
  for (const col of ['F', 'G', 'H', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R']) setores.getColumn(col).numFmt = '0.00';
  setores.getColumn('J').numFmt = FMT_MOEDA; setores.getColumn('K').numFmt = FMT_MOEDA;
  cabecalho(setores);

  const colab = wb.addWorksheet('Colaboradores');
  colab.columns = [
    { header: 'Nome', width: 30 }, { header: 'Setor', width: 18 }, { header: 'Turno', width: 12 }, { header: 'Situação', width: 20 }, { header: 'Exceção', width: 16 },
    { header: 'Prazo F1', width: 12 }, { header: 'Motivos', width: 34 }, { header: 'Salário', width: 14 },
    { header: 'Jornada atual (h)', width: 16 }, { header: 'Jornada F1 (h)', width: 14 }, { header: 'Jornada F2 (h)', width: 14 },
    { header: 'Divisor atual', width: 12 }, { header: 'Divisor F1', width: 11 }, { header: 'Divisor F2', width: 11 },
    { header: 'Valor/hora atual', width: 16 }, { header: 'Valor/hora F1', width: 14 }, { header: 'Valor/hora F2', width: 14 },
    { header: 'Horas perdidas F1 (h)', width: 20 }, { header: 'Horas perdidas F2 (h)', width: 20 }, { header: 'Alertas', width: 50 },
  ];
  for (const i of d.itens) {
    const f1 = i.f1 ?? i.f2;
    colab.addRow([i.nome, i.setor ?? '', i.turno ?? '', ROTULO_CLASSIFICACAO[i.classificacao], i.excecao ? ROTULO_EXCECAO[i.excecao] : '',
      f1.prazo && i.f1 && !i.f1.conforme ? aData(f1.prazo) : '', [...new Set([...(i.f1?.motivos ?? []), ...i.f2.motivos])].join(', '),
      i.salarioCentavos / 100, i.horasAtuaisMin / 60, f1.horasAlvoMin / 60, i.f2.horasAlvoMin / 60, i.divisorAtual, f1.divisor, i.f2.divisor,
      i.valorHoraAtualCentavos / 100, f1.valorHoraCentavos / 100, i.f2.valorHoraCentavos / 100, (i.f1?.horasPerdidasMin ?? 0) / 60, i.f2.horasPerdidasMin / 60, i.alertas.join(' | ')]);
  }
  colab.getColumn('F').numFmt = 'dd/mm/yyyy';
  for (const col of ['H', 'O', 'P', 'Q']) colab.getColumn(col).numFmt = FMT_MOEDA;
  for (const col of ['I', 'J', 'K', 'R', 'S']) colab.getColumn(col).numFmt = '0.00';
  colab.autoFilter = { from: 'A1', to: 'T1' };
  cabecalho(colab);

  const cen = wb.addWorksheet('Cenários');
  cen.columns = [{ header: 'Cenário', width: 30 }, { header: 'Tipo', width: 22 }, { header: 'Fase', width: 8 }, { header: 'Situação', width: 14 }, { header: 'Custo mensal', width: 18 },
    { header: 'Custo único', width: 16 }, { header: 'Custo anual', width: 18 }, { header: 'Contratações', width: 14 }, { header: 'Impacto do valor/hora nas HE', width: 28 }, { header: 'Alertas', width: 70 }];
  for (const x of dados.cenarios) {
    const r = x.resultado;
    cen.addRow([x.nome, ROTULO_CENARIO[r.tipo], r.fase, r.bloqueado ? 'Bloqueado' : 'Calculado', r.custoMensalCentavos / 100, r.custoUnicoCentavos / 100, r.custoAnualCentavos / 100, r.contratacoes, r.impactoValorHoraHeCentavos / 100, r.alertas.join(' | ')]);
  }
  for (const col of ['E', 'F', 'G', 'I']) cen.getColumn(col).numFmt = FMT_MOEDA;
  cabecalho(cen);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
