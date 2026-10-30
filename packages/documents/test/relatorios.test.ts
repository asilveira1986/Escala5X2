import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { data, decimal, gerarRelatorioPdf, gerarRelatorioXlsx, horasMin, moeda, MAX_LINHAS_COLABORADORES_PDF } from '../src';
import { dadosExemplo, PNG_1X1 } from './util';

const temPdftotext = spawnSync('pdftotext', ['-v']).error === undefined;
function textoDoPdf(pdf: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'jc-pdf-'));
  const f = join(dir, 'r.pdf');
  writeFileSync(f, pdf);
  return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
}

describe('formatação pt-BR', () => {
  it('moeda, data, horas e decimais', () => {
    expect(moeda(250_000)).toBe('R$ 2.500,00');
    expect(moeda(2_118_887)).toBe('R$ 21.188,87');
    expect(moeda(-5)).toMatch(/-R\$ 0,05/);
    expect(data('2026-12-15')).toBe('15/12/2026');
    expect(data(null)).toBe('—');
    expect(horasMin(2640)).toBe('44h');
    expect(horasMin(2670)).toBe('44h30');
    expect(horasMin(-120)).toBe('-2h');
    expect(decimal(1.5)).toBe('1,50');
  });
});

describe('relatório PDF', () => {
  it('gera um PDF válido com os números do diagnóstico, marca e aviso legal', async () => {
    const dados = dadosExemplo(12);
    const pdf = await gerarRelatorioPdf(dados);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
    if (!temPdftotext) return;
    const t = textoDoPdf(pdf);
    expect(t).toContain('Diagnóstico de adequação à escala 5x2 (EC 141/2026)');
    expect(t).toContain('Mercado Bom Preço Ltda');
    expect(t).toContain('12.345.678/0001-90');
    expect(t).toContain('Contabilidade Silva & Associados');
    expect(t).toContain('Data de referência 28/10/2026');
    expect(t).toContain('15/12/2026');
    expect(t).toContain(moeda(dados.diagnostico.resumo.folhaMensalCentavos));
    expect(t).toContain('Comparação de cenários');
    expect(t).toContain('Bloqueado');
    expect(t).toContain('Não substitui parecer jurídico');
    expect(t).toMatch(/Página 1 de \d+/);
    expect(t).toContain('Colaborador 001 Áçãõ');
    expect(t).toContain('44h › 42h › 40h'); // seta fora do WinAnsi virava "'" na fonte padrão do PDF
  });
  it('aceita logo PNG e cor inválida cai na cor padrão', async () => {
    const pdf = await gerarRelatorioPdf(dadosExemplo(3, { logo: PNG_1X1, corPrimaria: 'vermelho' }));
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
  it('limita a lista de colaboradores e avisa para usar o XLSX', async () => {
    const dados = dadosExemplo(900);
    const pdf = await gerarRelatorioPdf(dados);
    if (!temPdftotext) return;
    const t = textoDoPdf(pdf);
    const afetados = dados.diagnostico.itens.filter((i) => i.classificacao.startsWith('adequacao')).length;
    expect(afetados).toBeGreaterThan(MAX_LINHAS_COLABORADORES_PDF);
    expect(t).toContain(`Exibindo ${MAX_LINHAS_COLABORADORES_PDF} de`);
    expect(t).toMatch(/Página \d+ de \d+/);
  }, 60_000);
  it('sem cenários, omite a seção de comparação', async () => {
    const dados = { ...dadosExemplo(5), cenarios: [] };
    if (!temPdftotext) return;
    expect(textoDoPdf(await gerarRelatorioPdf(dados))).not.toContain('Comparação de cenários');
  });
});

describe('relatório XLSX', () => {
  it('traz abas, números reais, datas e formatos', async () => {
    const dados = dadosExemplo(12);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarRelatorioXlsx(dados)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumo', 'Setores', 'Colaboradores', 'Cenários']);

    const resumo = wb.getWorksheet('Resumo')!;
    const linha = (rot: string) => { let r: ExcelJS.Row | undefined; resumo.eachRow((row) => { if (row.getCell(1).value === rot) r = row; }); return r!; };
    expect(linha('Colaboradores analisados').getCell(2).value).toBe(12);
    expect(linha('Folha mensal').getCell(2).value).toBe(dados.diagnostico.resumo.folhaMensalCentavos / 100);
    expect(linha('Folha mensal').getCell(2).numFmt).toContain('R$');
    expect(linha('Data de referência').getCell(2).value).toEqual(new Date('2026-10-28T00:00:00Z'));
    expect(linha('Data de referência').getCell(2).numFmt).toBe('dd/mm/yyyy');

    const colab = wb.getWorksheet('Colaboradores')!;
    expect(colab.rowCount).toBe(13);
    const i0 = dados.diagnostico.itens[0]!;
    expect(colab.getRow(2).getCell(1).value).toBe(i0.nome);
    expect(colab.getRow(2).getCell(8).value).toBe(i0.salarioCentavos / 100);
    expect(colab.getRow(2).getCell(17).value as number).toBeCloseTo(i0.f2.valorHoraCentavos / 100, 6);
    expect(colab.getRow(2).getCell(4).value).toBe('Adequado'); // 40h em 5x2: alta renda sem necessidade de exceção

    const cen = wb.getWorksheet('Cenários')!;
    expect(cen.rowCount).toBe(4);
    expect(cen.getRow(4).getCell(4).value).toBe('Bloqueado');
    expect(cen.getRow(2).getCell(7).value).toBe(dados.cenarios[0]!.resultado.custoAnualCentavos / 100);
  });
  it('exporta todos os colaboradores (sem o limite do PDF)', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarRelatorioXlsx(dadosExemplo(1200))) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Colaboradores')!.rowCount).toBe(1201);
  }, 60_000);
});
