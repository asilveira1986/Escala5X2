import {
  dataDoNumero, diaDaSemana, divisorEfetivo, inicioDaSemana, minutosNoturnos, numeroDoDia, resolverRegras, somarDias, valorHoraCentavos,
  type Alocacao, type ContextoColaborador, type DataISO, type RegrasEfetivas,
} from '@jc/rules-engine';
import type { EntradaEscala } from './escala-entrada';
import { validarEntrada, type ResultadoValidacao } from './escala';
import { ErroServico } from './rpc';

/** Modelo de turno disponível para o otimizador (vem de `turno_modelo`). */
export type TurnoOtimizacao = { id: string; inicioMin: number; fimMin: number; intervaloMin: number };
export type PreferenciaOtimizacao = {
  colaboradorId: string; tipo: 'evitar_trabalho' | 'preferir_trabalho' | 'evitar_turno' | 'preferir_turno';
  data?: DataISO; diaSemana?: number; turnoId?: string; peso?: number;
};
export type OpcoesOtimizacao = {
  turnos: TurnoOtimizacao[];
  /** Dias em que a pessoa não pode trabalhar além das ausências já lançadas (ex.: pedido aprovado). */
  indisponibilidades?: Array<{ colaboradorId: string; data: DataISO }>;
  preferencias?: PreferenciaOtimizacao[];
  /** Escala anterior, para dar estabilidade (mudar o mínimo possível). */
  referencia?: Alocacao[];
  tempoLimiteS?: number; numSolucoes?: 1 | 2 | 3; semente?: number; workers?: number;
  pesos?: Partial<Record<'faltaCobertura' | 'deficitHorasPorMin' | 'faltaIdeal' | 'equidadeDomingos' | 'preferencia' | 'estabilidade' | 'custoPorReal', number>>;
  inicioSemana?: 0 | 1;
};

/** Contrato com o serviço Python (apps/optimizer/app/schemas.py). */
export type ProblemaOtimizador = {
  periodo: { inicio: DataISO; fim: DataISO }; inicioSemana: 0 | 1;
  turnos: Array<TurnoOtimizacao & { liquidoMin: number; noturnoMin: number }>;
  colaboradores: Array<{
    id: string; nome: string; permitidos: string[]; admissao?: DataISO; desligamento?: DataISO | null; ausencias: DataISO[]; indisponiveis: DataISO[];
    semanas: Array<{ inicio: DataISO; limiteMin: number; alvoMin: number; exigeFolgas: boolean; folgasExigidas: number; diasElegiveisFora: number; trabalhadosFora: number; completaNoPeriodo: boolean }>;
    interjornadaMin: number; rodizioDomingo?: number; custoHoraCentavos: number;
    anteriores: Array<{ data: DataISO; inicioMin: number; fimMin: number; liquidoMin: number }>;
    preferencias: Array<Omit<PreferenciaOtimizacao, 'colaboradorId'>>;
  }>;
  cobertura: Array<{ diaSemana: number; faixaInicioMin: number; faixaFimMin: number; minimo: number; ideal?: number }>;
  feriados: DataISO[];
  referencia: Array<{ colaboradorId: string; data: DataISO; turnoId: string | null }>;
  pesos?: OpcoesOtimizacao['pesos'];
  tempoLimiteS: number; numSolucoes: number; semente: number; workers: number;
};

const unicos = <T>(v: T[]): T[] => [...new Set(v)];

/**
 * Transforma a escala (já lida com as permissões do usuário) em problema combinatório: TODA regra legal é resolvida aqui
 * (limites semanais, folgas, interjornada, turnos permitidos por pessoa), com o mesmo motor que valida a escala.
 * O serviço Python só enxerga números.
 */
export function montarProblema(entrada: EntradaEscala, opcoes: OpcoesOtimizacao): ProblemaOtimizador {
  const { inicio: pIni, fim: pFim } = entrada.escala;
  const inicioSemana = opcoes.inicioSemana ?? 1;
  const nIni = numeroDoDia(pIni), nFim = numeroDoDia(pFim);
  const dias = Array.from({ length: nFim - nIni + 1 }, (_, i) => dataDoNumero(nIni + i));
  const dentro = (d: DataISO) => d >= pIni && d <= pFim;

  const turnos = opcoes.turnos.map((t) => ({
    ...t, liquidoMin: t.fimMin - t.inicioMin - t.intervaloMin, noturnoMin: minutosNoturnos(t.inicioMin, t.fimMin),
  }));
  for (const t of turnos) if (t.liquidoMin <= 0) throw new ErroServico(`O turno ${t.id} não tem horas líquidas (intervalo maior que o turno).`);

  const feriados = unicos(entrada.feriados.map((f) => f.data).filter(dentro));
  const semanas = unicos(dias.map((d) => inicioDaSemana(d, inicioSemana))).sort();

  const colaboradores = entrada.colaboradores.map((ctx: ContextoColaborador) => {
    const memo = new Map<DataISO, RegrasEfetivas>();
    const regrasEm = (d: DataISO) => memo.get(d) ?? (memo.set(d, resolverRegras(ctx, d, entrada.regras)), memo.get(d)!);
    const diasVigentes = dias.filter((d) => (!ctx.admissao || d >= ctx.admissao) && (!ctx.desligamento || d <= ctx.desligamento));
    const regrasDoPeriodo = (diasVigentes.length ? diasVigentes : dias).map(regrasEm);

    // Turnos que a pessoa pode fazer: sem hora extra programada, com o intervalo mínimo e sem passar do máximo sem acordo.
    const maxDiaria = Math.min(...regrasDoPeriodo.map((r) => (r.regimeCompensatorio && ctx.tipoEscala === r.regimeCompensatorio.escala ? r.regimeCompensatorio.maxDiariaMin : r.maxDiariaMin)));
    const r0 = regrasDoPeriodo[0]!;
    const exigidoAcima6 = Math.max(...regrasDoPeriodo.map((r) => r.intervaloMinAcima6hMin));
    const exigido4a6 = Math.max(...regrasDoPeriodo.map((r) => r.intervaloMin4a6hMin));
    const intervaloMax = Math.min(...regrasDoPeriodo.map((r) => r.intervaloMaxMin));
    const permitidos = turnos.filter((t) => {
      const bruto = t.fimMin - t.inicioMin;
      const exigido = bruto > 360 ? exigidoAcima6 : bruto > 240 ? exigido4a6 : 0;
      return t.liquidoMin <= maxDiaria && t.intervaloMin >= exigido && t.intervaloMin <= intervaloMax;
    }).map((t) => t.id);

    const anteriores = entrada.anteriores.filter((a) => a.colaboradorId === ctx.colaboradorId && a.tipo === 'trabalho' && a.inicioMin != null && a.fimMin != null)
      .map((a) => ({ data: a.data, inicioMin: a.inicioMin!, fimMin: a.fimMin!, liquidoMin: a.fimMin! - a.inicioMin! - (a.intervaloMin ?? 0) }));
    const menorAnterior = anteriores.reduce<DataISO | null>((m, a) => (m === null || a.data < m ? a.data : m), null);

    const ausenciasSet = new Set(entrada.ausencias.filter((a) => a.colaboradorId === ctx.colaboradorId).flatMap((a) => Array.from({ length: Math.max(0, numeroDoDia(a.fim) - numeroDoDia(a.inicio) + 1) }, (_, i) => dataDoNumero(numeroDoDia(a.inicio) + i))));
    const semanasColab = semanas.flatMap((w) => {
      const sete = Array.from({ length: 7 }, (_, i) => somarDias(w, i));
      const elegiveis = sete.filter((d) => !ctx.admissao || d >= ctx.admissao);
      if (elegiveis.length === 0) return [];
      const rs = elegiveis.map(regrasEm);
      const limiteMin = Math.min(...rs.map((r) => r.maxSemanalMin));
      const completa = (sete[0]! >= pIni && sete[6]! <= pFim) || (menorAnterior !== null && sete[0]! >= menorAnterior && sete[6]! <= pFim);
      const fora = sete.filter((d) => !dentro(d));
      // A meta de horas encolhe na proporção dos dias de ausência (férias/afastamento) da semana.
      const diasAusentes = sete.filter((d) => ausenciasSet.has(d)).length;
      return [{
        inicio: w, limiteMin, alvoMin: Math.round((Math.min(ctx.jornadaSemanalMin, limiteMin) * (7 - diasAusentes)) / 7),
        exigeFolgas: completa && sete.some(dentro), folgasExigidas: Math.max(...rs.map((r) => r.folgasPorSemana)),
        diasElegiveisFora: fora.filter((d) => !ctx.admissao || d >= ctx.admissao).length,
        trabalhadosFora: unicos(anteriores.filter((a) => a.data >= w && a.data <= sete[6]! && !dentro(a.data)).map((a) => a.data)).length,
        completaNoPeriodo: sete[0]! >= pIni && sete[6]! <= pFim,
      }];
    });

    const ausencias = unicos(entrada.ausencias.filter((a) => a.colaboradorId === ctx.colaboradorId).flatMap((a) => dias.filter((d) => d >= a.inicio && d <= a.fim)));
    const rodizios = dias.filter((d) => diaDaSemana(d) === 0).map((d) => regrasEm(d).domingoRodizio?.aCadaNSemanas).filter((n): n is number => !!n);
    const hora = valorHoraCentavos(ctx.salarioBaseCentavos, divisorEfetivo(r0, ctx));
    return {
      id: ctx.colaboradorId, nome: ctx.nome, permitidos, admissao: ctx.admissao, desligamento: ctx.desligamento ?? undefined,
      ausencias, indisponiveis: unicos((opcoes.indisponibilidades ?? []).filter((x) => x.colaboradorId === ctx.colaboradorId && dentro(x.data)).map((x) => x.data)),
      semanas: semanasColab,
      interjornadaMin: Math.max(...regrasDoPeriodo.map((r) => r.interjornadaMin)),
      ...(rodizios.length ? { rodizioDomingo: Math.min(...rodizios) } : {}),
      custoHoraCentavos: Math.round(hora), anteriores,
      preferencias: (opcoes.preferencias ?? []).filter((p) => p.colaboradorId === ctx.colaboradorId).map(({ colaboradorId: _c, ...resto }) => resto),
    };
  });

  const turnoPorHorario = new Map(turnos.map((t) => [`${t.inicioMin}|${t.fimMin}|${t.intervaloMin}`, t.id]));
  const referencia = (opcoes.referencia ?? []).filter((a) => dentro(a.data) && (a.tipo === 'trabalho' || a.tipo === 'folga' || a.tipo === 'dsr')).map((a) => ({
    colaboradorId: a.colaboradorId, data: a.data,
    turnoId: a.tipo === 'trabalho' ? turnoPorHorario.get(`${a.inicioMin}|${a.fimMin}|${a.intervaloMin ?? 0}`) ?? null : null,
  }));

  return {
    periodo: { inicio: pIni, fim: pFim }, inicioSemana, turnos, colaboradores, feriados, referencia,
    cobertura: entrada.cobertura.map((d) => ({ diaSemana: d.diaSemana, faixaInicioMin: d.faixaInicioMin, faixaFimMin: d.faixaFimMin, minimo: d.minimo, ...(d.ideal != null ? { ideal: d.ideal } : {}) })),
    ...(opcoes.pesos ? { pesos: opcoes.pesos } : {}),
    tempoLimiteS: opcoes.tempoLimiteS ?? 30, numSolucoes: opcoes.numSolucoes ?? 3, semente: opcoes.semente ?? 1, workers: opcoes.workers ?? 4,
  };
}

export type SolucaoOtimizador = {
  status: 'otima' | 'viavel';
  alocacoes: Array<{ colaboradorId: string; data: DataISO; tipo: 'trabalho' | 'folga'; turnoId?: string | null; inicioMin?: number | null; fimMin?: number | null; intervaloMin?: number | null }>;
  metricas: { faltaCobertura: number; faltaIdeal: number; deficitHorasMin: number; domingosMin: number; domingosMax: number; preferenciasNaoAtendidas: number; custoReais: number; mudancasEmRelacaoReferencia: number; objetivo: number };
};
export type RespostaOtimizador = { status: 'otima' | 'viavel' | 'inviavel'; solucoes: SolucaoOtimizador[]; mensagem?: string | null; tempoMs: number };

/** Proposta que passou pela revalidação do motor TypeScript (a fonte da verdade). */
export type Proposta = {
  indice: number; status: 'otima' | 'viavel'; metricas: SolucaoOtimizador['metricas'];
  alocacoes: Array<Alocacao & { modeloId?: string | null }>;
  alertas: number; infos: number;
};
export type ResultadoOtimizacao = { status: RespostaOtimizador['status']; propostas: Proposta[]; descartadas: number; mensagem?: string; tempoMs: number };

export const aAlocacoes = (s: SolucaoOtimizador): Array<Alocacao & { modeloId?: string | null }> => s.alocacoes.map((a) => (
  a.tipo === 'trabalho'
    ? { colaboradorId: a.colaboradorId, data: a.data, tipo: 'trabalho' as const, inicioMin: a.inicioMin!, fimMin: a.fimMin!, intervaloMin: a.intervaloMin ?? 0, modeloId: a.turnoId ?? null }
    : { colaboradorId: a.colaboradorId, data: a.data, tipo: 'folga' as const }
));

/**
 * Revalida cada solução com o motor TypeScript. Solução com bloqueio é DESCARTADA (divergência entre o modelo e o motor:
 * quem chama deve registrar o erro) e nunca chega ao usuário.
 */
export function revalidarSolucoes(entrada: EntradaEscala, resposta: RespostaOtimizador): ResultadoOtimizacao & { divergencias: Array<{ indice: number; resultado: ResultadoValidacao }> } {
  const propostas: Proposta[] = [];
  const divergencias: Array<{ indice: number; resultado: ResultadoValidacao }> = [];
  resposta.solucoes.forEach((s, indice) => {
    const alocacoes = aAlocacoes(s);
    const r = validarEntrada(entrada, alocacoes);
    if (r.bloqueios > 0) { divergencias.push({ indice, resultado: r }); return; }
    propostas.push({ indice, status: s.status, metricas: s.metricas, alocacoes, alertas: r.alertas, infos: r.infos });
  });
  return { status: resposta.status, propostas, descartadas: divergencias.length, mensagem: resposta.mensagem ?? undefined, tempoMs: resposta.tempoMs, divergencias };
}

export type ConfigOtimizador = { url: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number };

/** Chama o serviço Python (`POST /v1/otimizar`). Erros viram `ErroServico` com mensagem em português. */
export async function chamarOtimizador(cfg: ConfigOtimizador, problema: ProblemaOtimizador): Promise<RespostaOtimizador> {
  const f = cfg.fetchImpl ?? fetch;
  const controle = new AbortController();
  const limite = cfg.timeoutMs ?? (problema.tempoLimiteS + 30) * 1000;
  const timer = setTimeout(() => controle.abort(), limite);
  try {
    const r = await f(`${cfg.url.replace(/\/$/, '')}/v1/otimizar`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(problema), signal: controle.signal,
    });
    if (r.status === 429) throw new ErroServico('O otimizador está ocupado. Tente novamente em instantes.');
    if (r.status === 401 || r.status === 503) throw new ErroServico('O otimizador não está configurado corretamente (token).');
    if (!r.ok) throw new ErroServico(`O otimizador recusou o pedido (HTTP ${r.status}).`);
    return (await r.json()) as RespostaOtimizador;
  } catch (e) {
    if (e instanceof ErroServico) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new ErroServico('O otimizador demorou mais que o esperado.');
    throw new ErroServico('Não foi possível falar com o otimizador.');
  } finally {
    clearTimeout(timer);
  }
}

/** Monta o problema, otimiza e revalida. */
export async function gerarPropostas(entrada: EntradaEscala, opcoes: OpcoesOtimizacao, cfg: ConfigOtimizador): Promise<ResultadoOtimizacao & { divergencias: Array<{ indice: number; resultado: ResultadoValidacao }> }> {
  const problema = montarProblema(entrada, opcoes);
  return revalidarSolucoes(entrada, await chamarOtimizador(cfg, problema));
}
