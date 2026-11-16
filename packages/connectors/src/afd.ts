import { parseCnpj, parseCpf } from './parsers';

/**
 * Leitor do AFD (Arquivo Fonte de Dados) do registro eletrônico de ponto.
 *
 * Entende os dois leiautes em circulação:
 *  - `portaria_1510`: REPs certificados pela Portaria 1.510/2009 (e ainda em uso): registro tipo 3 com data ddmmaaaa, hora hhmm e PIS;
 *  - `portaria_671`: Portaria MTP 671/2021: registro tipo 3 (REP-C/REP-A) ou 7 (REP-P) com data/hora ISO 8601 com fuso e CPF.
 * Só as marcações (tipos 3 e 7) são lidas; os demais registros são contados e ignorados. O CRC-16 não é verificado.
 *
 * Princípio: nunca adivinhar. Linha que não bate com o leiaute vira erro com o número da linha (sem CPF/PIS no texto),
 * e o arquivo só é aceito se o cabeçalho for um cabeçalho de AFD.
 */
export type DialetoAfd = 'portaria_1510' | 'portaria_671';
export type TipoIdentificador = 'cpf' | 'pis';

export type MarcacaoAfd = {
  linha: number; nsr: number; tipoRegistro: '3' | '7';
  /** Instante da marcação em UTC (ISO 8601). */
  momento: string;
  /** Dia e hora no relógio de São Paulo (referência da escala). */
  dataLocal: string; horaLocal: string;
  /** CPF (11 dígitos) ou PIS (11 dígitos), só números. */
  identificador: string; tipoIdentificador: TipoIdentificador;
};
export type ErroAfd = { linha: number; mensagem: string; trecho: string };
export type ResultadoAfd = {
  valido: boolean;
  dialeto: DialetoAfd | null;
  empregador: { tipoDocumento: 'cnpj' | 'cpf'; documento: string } | null;
  marcacoes: MarcacaoAfd[];
  erros: ErroAfd[];
  avisos: string[];
  resumo: { linhas: number; marcacoes: number; duplicadasNoArquivo: number; ignoradosPorTipo: Record<string, number>; identificadores: number; primeiraData: string | null; ultimaData: string | null; trailer: boolean };
};

export const LIMITE_LINHAS_AFD = 600_000;
const MAX_ERROS = 200;

/** AFD costuma ser ISO-8859-1; arquivos novos podem ser UTF-8. Tenta UTF-8 estrito e cai para Latin-1. */
export function decodificarAfd(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); } catch { return new TextDecoder('latin1').decode(bytes); }
}

// ---- fuso de São Paulo (offset exato por data; o horário de verão existiu até 2019)
const fmtSP = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// Desde 17/02/2019 o Brasil não tem horário de verão: São Paulo é sempre UTC-3 (caminho rápido, sem Intl).
const FIM_HORARIO_VERAO_MS = Date.UTC(2019, 1, 17, 3, 0);
function locaisSP(utcMs: number): { data: string; hora: string; comoUtc: number } {
  if (utcMs >= FIM_HORARIO_VERAO_MS) {
    const d = new Date(utcMs - 3 * 3600_000), p2 = (n: number) => String(n).padStart(2, '0');
    return { data: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`, hora: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`, comoUtc: d.getTime() };
  }
  const p = Object.fromEntries(fmtSP.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, comoUtc: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) };
}
/** Hora de parede de São Paulo → instante UTC; null se o horário não existe (salto do horário de verão). */
export function instanteDeParedeSP(a: number, m: number, d: number, h: number, mi: number): number | null {
  const alvo = Date.UTC(a, m - 1, d, h, mi);
  if (alvo >= FIM_HORARIO_VERAO_MS) return alvo + 3 * 3600_000;
  let t = alvo - (locaisSP(alvo).comoUtc - alvo);
  t = alvo - (locaisSP(t).comoUtc - t);
  return locaisSP(t).comoUtc === alvo ? t : null;
}

function pisValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const r = 11 - (pesos.reduce((s, p, i) => s + p * Number(d[i]), 0) % 11);
  return (r >= 10 ? 0 : r) === Number(d[10]);
}

const RE_671 = /^(\d{9})([37])(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:?\d{2})(\d{12})/;
const RE_1510 = /^(\d{9})3(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})(\d{12})/;
const trecho = (l: string) => `${l.slice(0, 10)}…`;       // NSR e tipo; nunca o CPF/PIS

export function lerAfd(texto: string, opcoes: { agora?: Date } = {}): ResultadoAfd {
  const agora = opcoes.agora ?? new Date();
  const limiteFuturo = agora.getTime() + 36 * 3600_000;
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const r: ResultadoAfd = {
    valido: false, dialeto: null, empregador: null, marcacoes: [], erros: [], avisos: [],
    resumo: { linhas: linhas.length, marcacoes: 0, duplicadasNoArquivo: 0, ignoradosPorTipo: {}, identificadores: 0, primeiraData: null, ultimaData: null, trailer: false },
  };
  const erro = (linha: number, mensagem: string, l: string) => { if (r.erros.length < MAX_ERROS) r.erros.push({ linha, mensagem, trecho: trecho(l) }); };

  if (linhas.length === 0) { erro(0, 'O arquivo está vazio.', ''); return r; }
  if (linhas.length > LIMITE_LINHAS_AFD) { erro(0, `O arquivo tem mais de ${LIMITE_LINHAS_AFD.toLocaleString('pt-BR')} linhas. Gere o AFD de períodos menores.`, ''); return r; }

  // ---- cabeçalho
  const cab = linhas[0]!;
  if (!/^0{9}1[12]\d{14}/.test(cab)) {
    erro(1, 'A primeira linha não é um cabeçalho de AFD (esperado: NSR 000000000, registro tipo 1). Confira se o arquivo é mesmo um AFD.', cab);
    return r;
  }
  const doc = cab.slice(11, 25);
  r.empregador = cab[10] === '1'
    ? { tipoDocumento: 'cnpj', documento: doc }
    : { tipoDocumento: 'cpf', documento: doc.slice(3) };
  if (r.empregador.tipoDocumento === 'cnpj' && !parseCnpj(r.empregador.documento)) r.avisos.push('O CNPJ do cabeçalho não passou na verificação dos dígitos; confira o arquivo.');

  // ---- registros
  const vistos = new Set<string>();
  const nsrs = new Set<number>();
  const ids = new Set<string>();
  let linhasTipo3 = 0;
  let trailerTipo3: number | null = null;
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i]!, n = i + 1;
    const tipo = l[9];
    if (!/^\d{9}\d/.test(l)) { erro(n, 'Linha fora do leiaute do AFD (NSR e tipo de registro).', l); continue; }
    if (tipo === '9') {
      r.resumo.trailer = true;
      const t = /^0{9}9(\d{9})(\d{9})(\d{9})(\d{9})/.exec(l);          // leiaute 1510: quantidades dos tipos 2, 3, 4 e 5
      if (t) trailerTipo3 = Number(t[2]);
      continue;
    }
    if (tipo === '3') linhasTipo3++;
    if (tipo !== '3' && tipo !== '7') { r.resumo.ignoradosPorTipo[tipo!] = (r.resumo.ignoradosPorTipo[tipo!] ?? 0) + 1; continue; }

    let m: MarcacaoAfd | null = null;
    let dialeto: DialetoAfd;
    const m671 = RE_671.exec(l);
    if (m671) {
      dialeto = 'portaria_671';
      const [, nsr, tp, a, mo, d, h, mi, s, fusoBruto, cpf12] = m671;
      const fuso = fusoBruto!;
      const iso = `${a}-${mo}-${d}T${h}:${mi}:${s}${fuso === 'Z' ? 'Z' : fuso.includes(':') ? fuso : `${fuso.slice(0, 3)}:${fuso.slice(3)}`}`;
      const ms = Date.parse(iso);
      const cpf = parseCpf(cpf12!.slice(1));
      if (Number.isNaN(ms) || Number(mo) < 1 || Number(mo) > 12 || Number(h) > 23 || Number(mi) > 59) { erro(n, 'Data ou hora inválida na marcação.', l); continue; }
      if (!cpf || cpf12![0] !== '0') { erro(n, 'CPF da marcação inválido.', l); continue; }
      const loc = locaisSP(ms);
      m = { linha: n, nsr: Number(nsr), tipoRegistro: tp as '3' | '7', momento: new Date(ms).toISOString(), dataLocal: loc.data, horaLocal: loc.hora, identificador: cpf, tipoIdentificador: 'cpf' };
    } else {
      const m15 = tipo === '3' ? RE_1510.exec(l) : null;
      if (!m15) { erro(n, tipo === '7' ? 'Marcação tipo 7 fora do leiaute da Portaria 671.' : 'Marcação tipo 3 fora dos leiautes conhecidos (Portaria 1.510 ou 671).', l); continue; }
      dialeto = 'portaria_1510';
      const [, nsr, dd, mm, aaaa, hh, mi, pis12] = m15;
      const [a, mo, d, h, min] = [Number(aaaa), Number(mm), Number(dd), Number(hh), Number(mi)];
      const calendario = new Date(Date.UTC(a, mo - 1, d));
      if (h > 23 || min > 59 || calendario.getUTCFullYear() !== a || calendario.getUTCMonth() !== mo - 1 || calendario.getUTCDate() !== d) { erro(n, 'Data ou hora inválida na marcação.', l); continue; }
      const ms = instanteDeParedeSP(a, mo, d, h, min);
      if (ms === null) { erro(n, 'Horário inexistente (mudança de horário de verão).', l); continue; }
      const pis = pis12!.slice(1);
      if (pis12![0] !== '0' || !pisValido(pis)) { erro(n, 'PIS da marcação inválido.', l); continue; }
      const loc = locaisSP(ms);
      m = { linha: n, nsr: Number(nsr), tipoRegistro: '3', momento: new Date(ms).toISOString(), dataLocal: loc.data, horaLocal: loc.hora, identificador: pis, tipoIdentificador: 'pis' };
    }
    if (r.dialeto && r.dialeto !== dialeto) { erro(n, 'O arquivo mistura os leiautes da Portaria 1.510 e da 671.', l); continue; }
    r.dialeto = dialeto;
    const ms = Date.parse(m.momento);
    if (ms > limiteFuturo) { erro(n, 'Marcação com data no futuro.', l); continue; }
    if (m.dataLocal < '2000-01-01') { erro(n, 'Marcação com data anterior a 2000.', l); continue; }
    if (nsrs.has(m.nsr) && !r.avisos.includes('Há NSR repetido no arquivo.')) r.avisos.push('Há NSR repetido no arquivo.');
    nsrs.add(m.nsr);
    const chave = `${m.tipoIdentificador}:${m.identificador}:${m.momento}`;
    if (vistos.has(chave)) { r.resumo.duplicadasNoArquivo++; continue; }
    vistos.add(chave);
    ids.add(`${m.tipoIdentificador}:${m.identificador}`);
    r.marcacoes.push(m);
    if (!r.resumo.primeiraData || m.dataLocal < r.resumo.primeiraData) r.resumo.primeiraData = m.dataLocal;
    if (!r.resumo.ultimaData || m.dataLocal > r.resumo.ultimaData) r.resumo.ultimaData = m.dataLocal;
  }

  r.resumo.marcacoes = r.marcacoes.length;
  r.resumo.identificadores = ids.size;
  if (!r.resumo.trailer) r.avisos.push('O arquivo não tem a linha final (trailer): ele pode ter sido cortado. Confira se as marcações do fim do período estão presentes.');
  if (trailerTipo3 !== null && r.dialeto !== 'portaria_671' && trailerTipo3 !== linhasTipo3) {
    r.avisos.push(`O trailer informa ${trailerTipo3} marcações e o arquivo traz ${linhasTipo3}: ele pode estar incompleto ou ter sido editado.`);
  }
  if (r.marcacoes.length === 0 && r.erros.length === 0) r.avisos.push('O arquivo não tem nenhuma marcação de ponto.');
  r.valido = r.marcacoes.length > 0;
  return r;
}
