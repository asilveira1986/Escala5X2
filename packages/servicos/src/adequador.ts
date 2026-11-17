import {
  dataDoNumero, diaDaSemana, inicioDaSemana, numeroDoDia, resolverRegras, validarEscala,
  type Alocacao, type ContextoColaborador, type DataISO, type DemandaCobertura, type Violacao,
} from '@jc/rules-engine';
import type { AlocacaoComModelo, EntradaEscala } from './escala-entrada';

/**
 * Adequador de escala: a gestão define a escala de horas (turnos e quantas pessoas cada turno precisa em cada dia da semana) e o
 * sistema aloca a equipe: quem trabalha qual turno em cada dia, respeitando as folgas, o teto semanal, o rodízio de domingo e o
 * limite de dias seguidos que a lei e os acordos exigem. O resultado é conferido pelo motor de regras (mesmo da escala) e o que
 * faltar de cobertura aparece dia a dia. Roda no servidor, em milissegundos, sem serviço externo.
 */
export type TurnoAdequacao = {
  id: string; nome: string; inicioMin: number; fimMin: number; intervaloMin: number;
  /** Pessoas necessárias neste turno por dia da semana: índice 0 = domingo … 6 = sábado. */
  minimo: number[];
  /** Modelo de turno de onde veio (opcional): vai na alocação para o editor reconhecer. */
  modeloId?: string | null;
};
export type ParametrosAdequacao = {
  turnos: TurnoAdequacao[];
  /** Dias de trabalho por semana (5 = escala 5x2, 6 = 6x1). Sem valor: o que a regra de cada pessoa permite. Nunca passa do que a lei permite. */
  diasPorSemana?: number;
  /** Máximo de dias seguidos de trabalho (padrão 6). */
  maxDiasSeguidos?: number;
};

export type CoberturaDia = { data: DataISO; turnoId: string; necessario: number; alocado: number; falta: number };
export type ResumoPessoa = { colaboradorId: string; nome: string; turnoId: string | null; diasTrabalhados: number; horasSemanaMediaMin: number; domingosTrabalhados: number; feriadosTrabalhados: number };
export type ResultadoAdequacao = {
  alocacoes: AlocacaoComModelo[];
  turnoDe: Record<string, string>;
  cobertura: CoberturaDia[];
  pessoas: ResumoPessoa[];
  resumo: { necessarioTotal: number; alocadoTotal: number; faltaTotal: number; percentualAtendido: number; diasComFalta: number; pessoasAlocadas: number };
  violacoes: Violacao[];
  avisos: string[];
};

const MIN_DIA = 1440;
const liquido = (t: Pick<TurnoAdequacao, 'inicioMin' | 'fimMin' | 'intervaloMin'>) => t.fimMin - t.inicioMin - t.intervaloMin;

/** Erro de entrada (o que o usuário informou não dá para alocar). */
export class ErroAdequacao extends Error { constructor(m: string) { super(m); this.name = 'ErroAdequacao'; } }

export function validarTurnosAdequacao(turnos: TurnoAdequacao[]): void {
  if (turnos.length === 0) throw new ErroAdequacao('Informe pelo menos um turno.');
  const ids = new Set<string>();
  for (const t of turnos) {
    if (ids.has(t.id)) throw new ErroAdequacao('Há turnos repetidos.');
    ids.add(t.id);
    if (!Number.isInteger(t.inicioMin) || !Number.isInteger(t.fimMin) || t.inicioMin < 0 || t.inicioMin >= MIN_DIA) throw new ErroAdequacao(`Horário inválido no turno ${t.nome}.`);
    if (t.fimMin <= t.inicioMin || t.fimMin - t.inicioMin > MIN_DIA) throw new ErroAdequacao(`O turno ${t.nome} precisa terminar depois de começar e durar no máximo 24 horas.`);
    if (!Number.isInteger(t.intervaloMin) || t.intervaloMin < 0 || t.intervaloMin >= t.fimMin - t.inicioMin) throw new ErroAdequacao(`O intervalo do turno ${t.nome} precisa ser menor que o turno.`);
    if (!Array.isArray(t.minimo) || t.minimo.length !== 7 || t.minimo.some((m) => !Number.isInteger(m) || m < 0 || m > 500)) throw new ErroAdequacao(`A cobertura do turno ${t.nome} precisa ter 7 números (domingo a sábado).`);
  }
  if (turnos.every((t) => t.minimo.every((m) => m === 0))) throw new ErroAdequacao('Informe quantas pessoas cada turno precisa em pelo menos um dia da semana.');
}

function gerador(semente: number) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Pessoa = {
  ctx: ContextoColaborador; turno: number;                      // índice do turno
  disp: boolean[];                                              // dia disponível (vínculo ativo e sem ausência)
  trabalha: boolean[];
  runInicial: number;                                           // dias seguidos de trabalho que já vinham antes do período
  domingosAntes: number;                                        // domingos seguidos trabalhados que já vinham
};

export function adequarEscala(entrada: EntradaEscala, params: ParametrosAdequacao): ResultadoAdequacao {
  const turnos = params.turnos;
  validarTurnosAdequacao(turnos);
  const { inicio, fim } = entrada.escala;
  const nIni = numeroDoDia(inicio), nDias = numeroDoDia(fim) - nIni + 1;
  const dia = (i: number): DataISO => dataDoNumero(nIni + i);
  const dow = Array.from({ length: nDias }, (_, i) => diaDaSemana(dia(i)));
  const feriados = new Set(entrada.feriados.map((f) => f.data));
  const maxSeguidos = Math.max(1, Math.min(13, params.maxDiasSeguidos ?? 6));
  const avisos: string[] = [];

  // ---- equipe disponível
  const ausentes = (id: string, d: DataISO) => entrada.ausencias.some((a) => a.colaboradorId === id && d >= a.inicio && d <= a.fim);
  const equipe = entrada.colaboradores.filter((c) => (c.admissao ?? '0000-01-01') <= fim && (!c.desligamento || c.desligamento >= inicio));
  if (equipe.length === 0) throw new ErroAdequacao('Não há colaboradores com contrato vigente neste período.');
  if (entrada.semContrato.length > 0) avisos.push(`${entrada.semContrato.length} colaborador(es) sem contrato vigente ficaram de fora: ${entrada.semContrato.slice(0, 5).map((c) => c.nome).join(', ')}${entrada.semContrato.length > 5 ? '…' : ''}.`);

  // ---- 1) cada pessoa fica num turno (reparte a equipe pela necessidade de cada turno; quem já tem turno com o mesmo nome fica nele)
  const necessidade = turnos.map((t) => t.minimo.reduce((s, m) => s + m, 0));
  const totalNec = necessidade.reduce((s, n) => s + n, 0);
  const vagas = turnos.map(() => 0);
  const turnoPorNome = new Map(turnos.map((t, i) => [t.nome.trim().toLowerCase(), i]));
  const alvo = necessidade.map((n) => (n / totalNec) * equipe.length);                 // pessoas ideais por turno
  const escolha = new Map<string, number>();
  // quem já está num turno com o mesmo nome fica nele, até o que o turno precisa (o excedente é redistribuído)
  for (const c of equipe) { const i = c.turno ? turnoPorNome.get(c.turno.trim().toLowerCase()) : undefined; if (i !== undefined && necessidade[i]! > 0 && vagas[i]! < Math.ceil(alvo[i]!)) { escolha.set(c.colaboradorId, i); vagas[i]!++; } }
  const livres = equipe.filter((c) => !escolha.has(c.colaboradorId));
  const resto = livres.length;
  const falta = alvo.map((a, i) => Math.max(0, a - vagas[i]!));
  const somaFalta = falta.reduce((s, x) => s + x, 0) || 1;
  const cota = falta.map((f) => Math.floor((f / somaFalta) * resto));
  let sobra = resto - cota.reduce((s, x) => s + x, 0);
  const ordemResto = falta.map((f, i) => ({ i, r: (f / somaFalta) * resto - Math.floor((f / somaFalta) * resto) })).sort((a, b) => b.r - a.r);
  for (let k = 0; sobra > 0; k = (k + 1) % ordemResto.length) { if (necessidade[ordemResto[k]!.i]! > 0) { cota[ordemResto[k]!.i]!++; sobra--; } }
  const ordemLivres = [...livres].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  let cursor = 0;
  for (let i = 0; i < turnos.length; i++) for (let k = 0; k < cota[i]!; k++) { const c = ordemLivres[cursor++]; if (c) escolha.set(c.colaboradorId, i); }

  // ---- estado de cada pessoa
  const ate = (id: string) => entrada.anteriores.filter((a) => a.colaboradorId === id);
  const pessoas: Pessoa[] = equipe.map((c) => {
    const disp = Array.from({ length: nDias }, (_, i) => dia(i) >= (c.admissao ?? '0000-01-01') && (!c.desligamento || dia(i) <= c.desligamento) && !ausentes(c.colaboradorId, dia(i)));
    const trab = new Set(ate(c.colaboradorId).filter((a) => a.tipo === 'trabalho').map((a) => a.data));
    let run = 0; for (let d = nIni - 1; trab.has(dataDoNumero(d)); d--) run++;
    let dom = 0; for (let d = nIni - 1; d >= nIni - 70; d--) { if (diaDaSemana(dataDoNumero(d)) !== 0) continue; if (trab.has(dataDoNumero(d))) dom++; else break; }
    return { ctx: c, turno: escolha.get(c.colaboradorId) ?? 0, disp, trabalha: Array(nDias).fill(false), runInicial: run, domingosAntes: dom };
  });

  // ---- semanas (segunda a domingo) e a cota de dias de trabalho de cada pessoa em cada uma
  type Semana = { dias: number[] };                                                  // índices de dia dentro do período
  const semanas: Semana[] = [];
  const idxSemana = new Map<DataISO, Semana>();
  for (let i = 0; i < nDias; i++) {
    const k = inicioDaSemana(dia(i), 1);
    let s = idxSemana.get(k);
    if (!s) { s = { dias: [] }; idxSemana.set(k, s); semanas.push(s); }
    s.dias.push(i);
  }
  const cotaSemana = (p: Pessoa, s: Semana): number => {
    const t = turnos[p.turno]!, L = liquido(t);
    const regras = s.dias.map((i) => resolverRegras(p.ctx, dia(i), entrada.regras));
    const folgas = Math.max(...regras.map((r) => r.folgasPorSemana)), maxSem = Math.min(...regras.map((r) => r.maxSemanalMin));
    const lei = Math.min(7 - folgas, L > 0 ? Math.floor(maxSem / L) : 7);
    const pedida = params.diasPorSemana ?? 7 - folgas;
    let q = Math.min(pedida, lei);
    const k = s.dias.length;
    if (k < 7) q = Math.min(q, k - Math.floor((folgas * k) / 7));                      // semana parcial no começo/fim do mês: folgas proporcionais (o resto fica para o outro mês)
    return Math.max(0, Math.min(q, s.dias.filter((i) => p.disp[i]).length));
  };
  const cotas = pessoas.map((p) => semanas.map((s) => cotaSemana(p, s)));
  pessoas.forEach((p, pi) => {
    const t = turnos[p.turno]!;
    const maxPossivel = Math.max(...cotas[pi]!);
    if (maxPossivel * liquido(t) > 0 && params.diasPorSemana && params.diasPorSemana > maxPossivel && semanas.some((s) => s.dias.length === 7)) {
      avisos.push(`${p.ctx.nome}: o turno ${t.nome} (${Math.floor(liquido(t) / 60)}h${String(liquido(t) % 60).padStart(2, '0')} líquidas) limita a ${maxPossivel} dia(s) por semana pelo teto semanal.`);
    }
  });

  // ---- 2) ponto de partida: blocos de trabalho que avançam um dia por semana (rodízio natural de folgas e de domingos)
  const grupos = turnos.map((_, ti) => pessoas.filter((p) => p.turno === ti));
  grupos.forEach((g) => g.forEach((p, gi) => {
    const base = Math.floor((gi * 7) / Math.max(1, g.length));
    semanas.forEach((s, wi) => {
      const q = cotas[pessoas.indexOf(p)]![wi]!;
      const posDia = new Map(s.dias.map((i) => [(dow[i]! + 6) % 7, i]));                 // 0 = segunda … 6 = domingo
      const inicioTrab = (base + wi + (7 - Math.min(q, 7))) % 7;
      let feitos = 0;
      for (let k = 0; k < 7 && feitos < q; k++) { const i = posDia.get((inicioTrab + k) % 7); if (i !== undefined && p.disp[i]) { p.trabalha[i] = true; feitos++; } }
    });
  }));

  // ---- 3) melhoria local: troca dias de trabalho por dias de folga na mesma semana enquanto a cobertura melhora
  const cobre = Array.from({ length: nDias }, () => Array(turnos.length).fill(0) as number[]);
  const dom = pessoas.map(() => 0);
  pessoas.forEach((p, pi) => { for (let i = 0; i < nDias; i++) if (p.trabalha[i]) { cobre[i]![p.turno]!++; if (dow[i] === 0) dom[pi]!++; } });
  const regrasRodizio = pessoas.map((p) => resolverRegras(p.ctx, inicio, entrada.regras).domingoRodizio?.aCadaNSemanas ?? 0);
  const somaDom = grupos.map((g) => g.reduce((s, p) => s + dom[pessoas.indexOf(p)]!, 0));
  const custoCelula = (i: number, t: number, n: number) => {
    const m = turnos[t]!.minimo[dow[i]!]!;
    const falta = Math.max(0, m - n), sobra = Math.max(0, n - m);
    return falta * falta * 100 + sobra * sobra + (feriados.has(dia(i)) ? n * 3 : 0);
  };
  const violacoesPessoa = (pi: number): number => {
    const p = pessoas[pi]!, rod = regrasRodizio[pi]!;
    let run = p.runInicial, sobra = 0, domSeg = p.domingosAntes;
    for (let i = 0; i < nDias; i++) {
      if (p.trabalha[i]) { run++; if (run > maxSeguidos) sobra++; } else run = 0;
      if (dow[i] === 0) { if (p.trabalha[i]) { domSeg++; if (rod && domSeg >= rod) sobra++; } else domSeg = 0; }
    }
    return sobra;
  };
  let pesoDom = 1;                                                                     // 1ª fase: cobertura; 2ª fase: igualar domingos sem piorar a cobertura
  // custo de desigualdade de domingos no grupo (soma dos quadrados em torno da média): variação ao mudar a contagem de uma pessoa
  const variacaoDom = (pi: number, novo: number) => {
    const g = pessoas[pi]!.turno, antigo = dom[pi]!, n = grupos[g]!.length || 1;
    return ((novo * novo - antigo * antigo) - ((somaDom[g]! + novo - antigo) ** 2 - somaDom[g]! ** 2) / n) * pesoDom;
  };
  const rnd = gerador(20270101 + nDias * 31 + pessoas.length);
  const iteracoes = Math.max(80_000, Math.min(300_000, pessoas.length * nDias * 200));
  const viol = pessoas.map((_, pi) => violacoesPessoa(pi));
  const semanasMultiplas = semanas.map((s, wi) => ({ s, wi }));
  const fase2 = Math.floor(iteracoes * 0.7);
  for (let it = 0; it < iteracoes; it++) {
    if (it === fase2) pesoDom = 12;
    const pi = Math.floor(rnd() * pessoas.length), p = pessoas[pi]!;
    const { s } = semanasMultiplas[Math.floor(rnd() * semanasMultiplas.length)]!;
    const trabalhando = s.dias.filter((i) => p.trabalha[i]);
    const folgando = s.dias.filter((i) => !p.trabalha[i] && p.disp[i]);
    if (trabalhando.length === 0 || folgando.length === 0) continue;
    const a = trabalhando[Math.floor(rnd() * trabalhando.length)]!, b = folgando[Math.floor(rnd() * folgando.length)]!;
    const t = p.turno;
    const antesCusto = custoCelula(a, t, cobre[a]![t]!) + custoCelula(b, t, cobre[b]![t]!);
    const antesViol = viol[pi]!;
    p.trabalha[a] = false; p.trabalha[b] = true;
    const domNovo = dom[pi]! - (dow[a] === 0 ? 1 : 0) + (dow[b] === 0 ? 1 : 0);
    const depoisCusto = custoCelula(a, t, cobre[a]![t]! - 1) + custoCelula(b, t, cobre[b]![t]! + 1) + (domNovo !== dom[pi]! ? variacaoDom(pi, domNovo) : 0);
    const depoisViol = violacoesPessoa(pi);
    const coberturaDelta = custoCelula(a, t, cobre[a]![t]! - 1) + custoCelula(b, t, cobre[b]![t]! + 1) - custoCelula(a, t, cobre[a]![t]!) - custoCelula(b, t, cobre[b]![t]!);
    const delta = depoisCusto - antesCusto + (depoisViol - antesViol) * 100_000;
    if (it >= fase2 && coberturaDelta > 0) { p.trabalha[a] = true; p.trabalha[b] = false; continue; }      // 2ª fase: não vale piorar a cobertura
    if (delta < 0 || (delta === 0 && rnd() < 0.2)) { cobre[a]![t]!--; cobre[b]![t]!++; somaDom[t] = somaDom[t]! + domNovo - dom[pi]!; dom[pi] = domNovo; viol[pi] = depoisViol; }
    else { p.trabalha[a] = true; p.trabalha[b] = false; }
  }

  // ---- 4) alocações
  const alocacoes: AlocacaoComModelo[] = [];
  const turnoDe: Record<string, string> = {};
  pessoas.forEach((p) => {
    const t = turnos[p.turno]!;
    turnoDe[p.ctx.colaboradorId] = t.id;
    for (let i = 0; i < nDias; i++) {
      if (!p.disp[i]) continue;
      if (p.trabalha[i]) alocacoes.push({ colaboradorId: p.ctx.colaboradorId, data: dia(i), tipo: 'trabalho', inicioMin: t.inicioMin, fimMin: t.fimMin, intervaloMin: t.intervaloMin, ...(t.modeloId ? { modeloId: t.modeloId } : {}) });
      else alocacoes.push({ colaboradorId: p.ctx.colaboradorId, data: dia(i), tipo: 'folga' });
    }
  });

  // ---- 5) cobertura, resumo e conferência pelo motor de regras
  const coberturaDias: CoberturaDia[] = [];
  for (let i = 0; i < nDias; i++) for (let t = 0; t < turnos.length; t++) {
    const necessario = turnos[t]!.minimo[dow[i]!]!;
    if (necessario === 0) continue;
    const alocado = cobre[i]![t]!;
    coberturaDias.push({ data: dia(i), turnoId: turnos[t]!.id, necessario, alocado, falta: Math.max(0, necessario - alocado) });
  }
  const necessarioTotal = coberturaDias.reduce((s, c) => s + c.necessario, 0);
  const faltaTotal = coberturaDias.reduce((s, c) => s + c.falta, 0);
  const alocadoTotal = coberturaDias.reduce((s, c) => s + Math.min(c.alocado, c.necessario), 0);
  // média por semana COMPLETA (as pontas do mês, com menos de 7 dias, distorceriam a conta); sem semana completa, usa todas
  const mediaSemanal = (p: Pessoa, L: number): number => {
    const completas = semanas.filter((s) => s.dias.length === 7), base = completas.length > 0 ? completas : semanas;
    const dias = base.reduce((t, s) => t + s.dias.filter((i) => p.trabalha[i]).length, 0);
    return Math.round((dias * L) / base.length);
  };
  const resumoPessoas: ResumoPessoa[] = pessoas.map((p, pi) => {
    const L = liquido(turnos[p.turno]!);
    const dias = p.trabalha.filter(Boolean).length;
    return {
      colaboradorId: p.ctx.colaboradorId, nome: p.ctx.nome, turnoId: turnos[p.turno]!.id, diasTrabalhados: dias,
      horasSemanaMediaMin: mediaSemanal(p, L), domingosTrabalhados: dom[pi]!,
      feriadosTrabalhados: p.trabalha.reduce((s, w, i) => s + (w && feriados.has(dia(i)) ? 1 : 0), 0),
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const coberturaMotor: DemandaCobertura[] = turnos.flatMap((t) => t.minimo.map((m, d) => ({ diaSemana: d, faixaInicioMin: t.inicioMin % MIN_DIA, faixaFimMin: t.fimMin > MIN_DIA ? t.fimMin - MIN_DIA : t.fimMin, minimo: m })).filter((c) => c.minimo > 0));
  const violacoes = validarEscala({ periodo: { inicio, fim }, alocacoes: alocacoes as Alocacao[], anteriores: entrada.anteriores, ausencias: entrada.ausencias, feriados: entrada.feriados, cobertura: coberturaMotor }, equipe, entrada.regras);
  if (faltaTotal > 0) {
    avisos.push(`Faltam ${faltaTotal} posição(ões) de cobertura no mês com a equipe atual (${equipe.length} pessoa(s)). Ajuste os horários, reduza a cobertura pedida ou reforce a equipe.`);
  }
  return {
    alocacoes, turnoDe, cobertura: coberturaDias, pessoas: resumoPessoas,
    resumo: { necessarioTotal, alocadoTotal, faltaTotal, percentualAtendido: necessarioTotal === 0 ? 100 : Math.round((alocadoTotal / necessarioTotal) * 1000) / 10, diasComFalta: coberturaDias.filter((c) => c.falta > 0).length, pessoasAlocadas: pessoas.length },
    violacoes, avisos,
  };
}
