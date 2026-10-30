import { CAMPOS_COLABORADOR, camposObrigatoriosSemColuna, type CampoColaborador, type Mapeamento } from './mapeamento';
import type { Linha } from './planilha';
import { parseCpf, parseData, parseDinheiroCentavos, parseEscolaridade, parseHorasMin, parseJornadaMin, parseTelefone, parseTipoEscala } from './parsers';

export type ColaboradorImportado = {
  /** Número da linha na planilha original (cabeçalho = 1). */
  linha: number;
  nome: string;
  cpf: string;
  matricula: string | null;
  cargo: string | null;
  cbo: string | null;
  admissao: string;
  desligamento: string | null;
  escolaridade: 'fundamental' | 'medio' | 'superior' | 'pos' | null;
  telefone: string | null;
  setor: string | null;
  turno: string | null;
  salarioCentavos: number;
  jornadaSemanalMin: number;
  divisor: number;
  tipoEscala: '6x1' | '5x2' | '12x36' | 'personalizada';
  folgasSemana: number | null;
  horasExtrasMensaisMin: number;
  avisos: string[];
};

export type ErroLinha = { linha: number; campo: CampoColaborador | 'geral'; valor: string; mensagem: string };
export type ResultadoValidacao = { validas: ColaboradorImportado[]; erros: ErroLinha[]; ignoradas: number };

const SALARIO_MAX_CENTAVOS = 1_000_000_00;

export function validarColaboradores(linhas: Linha[], mapeamento: Mapeamento): ResultadoValidacao {
  const faltando = camposObrigatoriosSemColuna(mapeamento);
  if (faltando.length > 0) {
    const rotulos = CAMPOS_COLABORADOR.filter((c) => faltando.includes(c.chave)).map((c) => c.rotulo).join(', ');
    return { validas: [], erros: [{ linha: 1, campo: 'geral', valor: '', mensagem: `Mapeie as colunas obrigatórias: ${rotulos}.` }], ignoradas: 0 };
  }
  const validas: ColaboradorImportado[] = [];
  const erros: ErroLinha[] = [];
  const cpfsVistos = new Map<string, number>();
  let ignoradas = 0;

  linhas.forEach((row, idx) => {
    const linha = idx + 2;
    const col = (c: CampoColaborador): string => {
      const nome = mapeamento[c];
      return nome ? (row[nome] ?? '').trim() : '';
    };
    if (Object.values(row).every((v) => v.trim() === '')) { ignoradas++; return; }
    const errosLinha: ErroLinha[] = [];
    const falha = (campo: CampoColaborador, mensagem: string) => errosLinha.push({ linha, campo, valor: col(campo), mensagem });
    const avisos: string[] = [];

    const nome = col('nome');
    if (nome.length < 2) falha('nome', 'Nome obrigatório.');

    const cpf = parseCpf(col('cpf'));
    if (!cpf) falha('cpf', col('cpf') ? 'CPF inválido (dígito verificador não confere).' : 'CPF obrigatório.');
    else if (cpfsVistos.has(cpf)) falha('cpf', `CPF repetido (já aparece na linha ${cpfsVistos.get(cpf)}).`);

    const admissao = parseData(col('admissao'));
    if (!admissao) falha('admissao', col('admissao') ? 'Data de admissão inválida. Use dd/mm/aaaa.' : 'Data de admissão obrigatória.');

    let desligamento: string | null = null;
    if (col('desligamento')) {
      desligamento = parseData(col('desligamento'));
      if (!desligamento) falha('desligamento', 'Data de desligamento inválida. Use dd/mm/aaaa.');
      else if (admissao && desligamento < admissao) falha('desligamento', 'Desligamento anterior à admissão.');
    }

    const salario = parseDinheiroCentavos(col('salario'));
    if (salario === null || salario <= 0) falha('salario', col('salario') ? 'Salário inválido.' : 'Salário obrigatório.');
    else if (salario > SALARIO_MAX_CENTAVOS) falha('salario', 'Salário acima de R$ 1.000.000,00: confira a formatação.');

    const jornada = parseJornadaMin(col('jornada_semanal'));
    if (jornada === null || jornada < 60 || jornada > 60 * 60) falha('jornada_semanal', 'Jornada semanal inválida (use horas entre 1 e 60, ex.: 44 ou 44:00).');

    const tipoEscala = parseTipoEscala(col('tipo_escala'));
    if (!tipoEscala) falha('tipo_escala', 'Escala inválida. Use 6x1, 5x2, 12x36 ou personalizada.');

    let divisor = 0;
    if (col('divisor')) {
      const d = Number(col('divisor').replace(',', '.'));
      if (!Number.isInteger(d) || d < 50 || d > 300) falha('divisor', 'Divisor inválido (inteiro entre 50 e 300).');
      else divisor = d;
    } else if (jornada) {
      divisor = Math.round((jornada * 5) / 60);
      avisos.push(`Divisor não informado: presumido ${divisor} (jornada semanal × 5).`);
    }

    let folgas: number | null = null;
    if (col('folgas_semana')) {
      const f = Number(col('folgas_semana'));
      if (!Number.isInteger(f) || f < 0 || f > 6) falha('folgas_semana', 'Folgas por semana deve ser um inteiro de 0 a 6.');
      else folgas = f;
    }

    let he = 0;
    if (col('horas_extras_mensais')) {
      const m = parseHorasMin(col('horas_extras_mensais'));
      if (m === null || m > 200 * 60) falha('horas_extras_mensais', 'Horas extras mensais inválidas (0 a 200 horas).');
      else he = m;
    }

    let telefone: string | null = null;
    if (col('telefone')) {
      telefone = parseTelefone(col('telefone'));
      if (!telefone) avisos.push('Telefone inválido: ignorado.');
    }

    let escolaridade: ColaboradorImportado['escolaridade'] = null;
    if (col('escolaridade')) {
      escolaridade = parseEscolaridade(col('escolaridade'));
      if (!escolaridade) avisos.push(`Escolaridade "${col('escolaridade')}" não reconhecida: ignorada.`);
    } else {
      avisos.push('Escolaridade não informada: a exceção de alta renda não poderá ser aplicada.');
    }

    if (errosLinha.length > 0) { erros.push(...errosLinha); if (cpf) cpfsVistos.set(cpf, cpfsVistos.get(cpf) ?? linha); return; }
    cpfsVistos.set(cpf!, linha);
    validas.push({
      linha, nome, cpf: cpf!, matricula: col('matricula') || null, cargo: col('cargo') || null,
      cbo: col('cbo').replace(/\D/g, '') || null, admissao: admissao!, desligamento,
      escolaridade, telefone, setor: col('setor') || null, turno: col('turno') || null,
      salarioCentavos: salario!, jornadaSemanalMin: jornada!, divisor, tipoEscala: tipoEscala!, folgasSemana: folgas,
      horasExtrasMensaisMin: he, avisos,
    });
  });
  return { validas, erros, ignoradas };
}

/** CSV de erros para o usuário corrigir e reenviar (UTF-8 com BOM, separador ';' para abrir direto no Excel). */
export function errosParaCsv(erros: ErroLinha[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const linhas = [['Linha', 'Campo', 'Valor', 'Problema'].join(';'), ...erros.map((e) => [e.linha, e.campo, esc(e.valor), esc(e.mensagem)].join(';'))];
  return `﻿${linhas.join('\r\n')}\r\n`;
}
