import { maxData, somarDias, vigenciaContem, type DataISO } from './datas';
import { divisorEfetivo, resolverRegras, valorHoraCentavos } from './resolver';
import { ErroRegras, type ContextoColaborador, type Regra, type RegrasEfetivas, type TipoEscala } from './tipos';

export type Classificacao = 'adequado' | 'adequacao_f1' | 'adequacao_f2' | 'excecao';
export type TipoExcecao = 'alta_renda' | 'acordo';

export type EstadoFase = {
  conforme: boolean;
  motivos: string[];
  /** Primeira data da fase em que o colaborador deixa de estar conforme (prazo para adequar). */
  prazo: DataISO | null;
  horasAlvoMin: number;
  horasPerdidasMin: number;
  diasFolgaFaltantes: number;
  divisor: number;
  valorHoraCentavos: number;
  regrasAplicadas: string[];
};

export type ItemDiagnostico = {
  colaboradorId: string;
  nome: string;
  setor: string | null;
  turno: string | null;
  classificacao: Classificacao;
  excecao: TipoExcecao | null;
  salarioCentavos: number;
  salarioNovoCentavos: number; // nunca menor que o atual
  horasAtuaisMin: number;
  divisorAtual: number;
  valorHoraAtualCentavos: number;
  horasExtrasMensaisMin: number;
  f1: EstadoFase | null; // null quando a fase 1 já terminou na data de referência
  f2: EstadoFase;
  alertas: string[];
};

export type Fases = { f1Inicio: DataISO; f1Fim: DataISO; f2Inicio: DataISO };

const FOLGAS_PADRAO: Record<Exclude<TipoEscala, 'personalizada'>, number> = { '6x1': 1, '5x2': 2, '12x36': 3 };

export function folgasDoColaborador(ctx: ContextoColaborador): { folgas: number; presumido: boolean } {
  if (ctx.folgasSemana !== null && ctx.folgasSemana !== undefined) return { folgas: ctx.folgasSemana, presumido: false };
  if (ctx.tipoEscala === 'personalizada') return { folgas: 1, presumido: true };
  return { folgas: FOLGAS_PADRAO[ctx.tipoEscala], presumido: false };
}

/** Fases da lei lidas das regras cadastradas (datas parametrizáveis, nunca fixas no código). */
export function obterFases(regras: Regra[]): Fases {
  const f1 = regras.find((r) => r.ativa && r.codigo === 'EC141_F1' && Object.keys(r.escopo).length === 0);
  const f2 = regras.find((r) => r.ativa && r.codigo === 'EC141_F2' && Object.keys(r.escopo).length === 0);
  if (!f1?.vigencia.inicio || !f1.vigencia.fim) throw new ErroRegras('Regra EC141_F1 ausente ou sem vigência fechada');
  if (!f2?.vigencia.inicio) throw new ErroRegras('Regra EC141_F2 ausente');
  return { f1Inicio: f1.vigencia.inicio, f1Fim: f1.vigencia.fim, f2Inicio: f2.vigencia.inicio };
}

type Conformidade = { conforme: boolean; motivos: string[]; excecao: TipoExcecao | null };

export function avaliarConformidade(ctx: ContextoColaborador, e: RegrasEfetivas): Conformidade {
  const { folgas } = folgasDoColaborador(ctx);
  if (e.regimeCompensatorio && ctx.tipoEscala === e.regimeCompensatorio.escala) {
    const ok = ctx.jornadaSemanalMin <= e.maxSemanalMin;
    return { conforme: ok, motivos: ok ? [] : ['jornada_acima_do_teto_do_acordo'], excecao: 'acordo' };
  }
  const motivos: string[] = [];
  if (folgas < e.folgasPorSemana) motivos.push('folgas_insuficientes');
  if (ctx.jornadaSemanalMin > e.maxSemanalMin) motivos.push('jornada_acima_do_teto');
  const altaRenda = e.regrasAplicadas.includes('EC141_ALTA_RENDA') && ctx.jornadaSemanalMin > e.tetoGeralSemanalMin;
  return { conforme: motivos.length === 0, motivos, excecao: altaRenda ? 'alta_renda' : null };
}

function pontosDeMudanca(ctx: ContextoColaborador, regras: Regra[], de: DataISO, ate: DataISO): DataISO[] {
  const datas = new Set<DataISO>([de]);
  const candidatos = [
    ...regras.flatMap((r) => [r.vigencia.inicio, r.vigencia.fim]),
    ...ctx.acordos.flatMap((a) => [a.vigencia.inicio, a.vigencia.fim]),
  ];
  for (const d of candidatos) if (d && d > de && d < ate) datas.add(d);
  return [...datas].sort();
}

function estado(ctx: ContextoColaborador, regras: Regra[], de: DataISO, ate: DataISO | null, horizonte: DataISO): { estado: EstadoFase; excecao: TipoExcecao | null } {
  const fim = ate ?? horizonte;
  const pontos = pontosDeMudanca(ctx, regras, de, fim);
  let prazo: DataISO | null = null;
  let motivos: string[] = [];
  for (const d of pontos) {
    const c = avaliarConformidade(ctx, resolverRegras(ctx, d, regras));
    if (!c.conforme) { prazo = d; motivos = c.motivos; break; }
  }
  // Alvos e divisor refletem o estado final da fase (ex.: terceirizada pública só muda após o prazo).
  const dRef = ate ? somarDias(ate, -1) : de;
  const e = resolverRegras(ctx, dRef, regras);
  const conf = avaliarConformidade(ctx, e);
  const horasAlvo = Math.min(ctx.jornadaSemanalMin, e.maxSemanalMin);
  const { folgas } = folgasDoColaborador(ctx);
  const divisor = Math.min(divisorEfetivo(e, ctx), ctx.divisorContrato);
  const excecaoAtiva = e.regimeCompensatorio && ctx.tipoEscala === e.regimeCompensatorio.escala;
  return {
    excecao: conf.excecao,
    estado: {
      conforme: prazo === null && conf.conforme,
      motivos: prazo === null ? conf.motivos : motivos,
      prazo: prazo ?? (conf.conforme ? null : de),
      horasAlvoMin: horasAlvo,
      horasPerdidasMin: ctx.jornadaSemanalMin - horasAlvo,
      diasFolgaFaltantes: excecaoAtiva ? 0 : Math.max(0, e.folgasPorSemana - folgas),
      divisor,
      valorHoraCentavos: valorHoraCentavos(ctx.salarioBaseCentavos, divisor),
      regrasAplicadas: e.regrasAplicadas,
    },
  };
}

export function diagnosticarColaborador(ctx: ContextoColaborador, dataRef: DataISO, regras: Regra[], fases = obterFases(regras)): ItemDiagnostico {
  const alertas: string[] = [];
  const { presumido } = folgasDoColaborador(ctx);
  if (presumido) alertas.push('Folgas por semana não informadas para escala personalizada; presumida 1 folga.');
  if (ctx.jornadaSemanalMin <= 0 || ctx.divisorContrato <= 0) throw new ErroRegras(`Contrato inválido para ${ctx.nome}`);

  const f1Ativa = dataRef < fases.f1Fim;
  const f1 = f1Ativa ? estado(ctx, regras, maxData(dataRef, fases.f1Inicio), fases.f1Fim, fases.f1Fim) : null;
  // Fase 2 não tem fim: avalia-se o estado no início; vencimentos posteriores de acordo viram alerta.
  const f2Inicio = maxData(dataRef, fases.f2Inicio);
  const f2 = estado(ctx, regras, f2Inicio, null, somarDias(f2Inicio, 1));

  const excecao = f1?.excecao ?? f2.excecao;
  let classificacao: Classificacao;
  if (f1 && !f1.estado.conforme) classificacao = 'adequacao_f1';
  else if (!f2.estado.conforme) classificacao = 'adequacao_f2';
  else if (excecao) classificacao = 'excecao';
  else classificacao = 'adequado';

  if (excecao === 'alta_renda' && classificacao !== 'adequacao_f1' && classificacao !== 'adequacao_f2') {
    alertas.push('Alta renda: jornada diferenciada permitida, mantida a 5x2.');
  }
  // Acordo que vence antes de a exceção deixar de ser necessária.
  for (const a of ctx.acordos) {
    if (a.status === 'vigente' && a.vigencia.fim && vigenciaContem(a.vigencia, maxData(dataRef, fases.f1Inicio)) && excecao === 'acordo') {
      alertas.push(`Acordo ${a.id} vence em ${a.vigencia.fim}.`);
    }
  }

  const divisorAtual = ctx.divisorContrato;
  return {
    colaboradorId: ctx.colaboradorId,
    nome: ctx.nome,
    setor: ctx.setor ?? null,
    turno: ctx.turno ?? null,
    classificacao,
    excecao,
    salarioCentavos: ctx.salarioBaseCentavos,
    salarioNovoCentavos: ctx.salarioBaseCentavos, // regra de ouro: salário jamais é reduzido
    horasAtuaisMin: ctx.jornadaSemanalMin,
    divisorAtual,
    valorHoraAtualCentavos: valorHoraCentavos(ctx.salarioBaseCentavos, divisorAtual),
    horasExtrasMensaisMin: ctx.horasExtrasMensaisMin ?? 0,
    f1: f1?.estado ?? null,
    f2: f2.estado,
    alertas,
  };
}

export type AgregadoGrupo = {
  setor: string | null;
  turno: string | null;
  colaboradores: number;
  afetadosF1: number;
  afetadosF2: number;
  horasPerdidasF1Min: number;
  horasPerdidasF2Min: number;
  fteF1: number;
  fteF2: number;
  /** Estimativa: déficit semanal distribuído igualmente nos dias de operação (índice 0 = domingo). */
  deficitPorDiaSemanaF2Min: number[];
  salarioMedioCentavos: number;
  valorHoraMedioF1Centavos: number;
  valorHoraMedioF2Centavos: number;
  horasAlvoMediaF1Min: number;
  horasAlvoMediaF2Min: number;
};

export type Diagnostico = {
  dataReferencia: DataISO;
  fases: Fases;
  itens: ItemDiagnostico[];
  resumo: {
    total: number;
    porClassificacao: Record<Classificacao, number>;
    folhaMensalCentavos: number;
    horasPerdidasF1Min: number;
    horasPerdidasF2Min: number;
    fteF1: number;
    fteF2: number;
  };
  grupos: AgregadoGrupo[];
};

const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const arred = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

export function diagnosticar(colaboradores: ContextoColaborador[], dataRef: DataISO, regras: Regra[], opcoes: { diasOperacao?: number[] } = {}): Diagnostico {
  const fases = obterFases(regras);
  const itens = colaboradores.map((c) => diagnosticarColaborador(c, dataRef, regras, fases));
  const dias = opcoes.diasOperacao?.length ? opcoes.diasOperacao : [0, 1, 2, 3, 4, 5, 6];

  const mapa = new Map<string, ItemDiagnostico[]>();
  for (const i of itens) {
    const k = JSON.stringify([i.setor, i.turno]);
    (mapa.get(k) ?? mapa.set(k, []).get(k)!).push(i);
  }
  const grupos: AgregadoGrupo[] = [...mapa.values()].map((g) => {
    const f1s = g.map((i) => i.f1 ?? i.f2);
    const alvo1 = media(f1s.map((s) => s.horasAlvoMin));
    const alvo2 = media(g.map((i) => i.f2.horasAlvoMin));
    const perdF1 = g.reduce((a, i) => a + (i.f1?.horasPerdidasMin ?? 0), 0);
    const perdF2 = g.reduce((a, i) => a + i.f2.horasPerdidasMin, 0);
    const porDia = Array<number>(7).fill(0);
    for (const d of dias) porDia[d] = arred(perdF2 / dias.length);
    return {
      setor: g[0]!.setor, turno: g[0]!.turno,
      colaboradores: g.length,
      afetadosF1: g.filter((i) => i.f1 && i.f1.horasPerdidasMin > 0).length,
      afetadosF2: g.filter((i) => i.f2.horasPerdidasMin > 0).length,
      horasPerdidasF1Min: perdF1, horasPerdidasF2Min: perdF2,
      fteF1: alvo1 ? arred(perdF1 / alvo1) : 0,
      fteF2: alvo2 ? arred(perdF2 / alvo2) : 0,
      deficitPorDiaSemanaF2Min: porDia,
      salarioMedioCentavos: Math.round(media(g.map((i) => i.salarioCentavos))),
      valorHoraMedioF1Centavos: arred(media(f1s.map((s) => s.valorHoraCentavos)), 4),
      valorHoraMedioF2Centavos: arred(media(g.map((i) => i.f2.valorHoraCentavos)), 4),
      horasAlvoMediaF1Min: arred(alvo1), horasAlvoMediaF2Min: arred(alvo2),
    };
  });

  const porClassificacao: Record<Classificacao, number> = { adequado: 0, adequacao_f1: 0, adequacao_f2: 0, excecao: 0 };
  for (const i of itens) porClassificacao[i.classificacao]++;
  return {
    dataReferencia: dataRef, fases, itens, grupos,
    resumo: {
      total: itens.length,
      porClassificacao,
      folhaMensalCentavos: itens.reduce((a, i) => a + i.salarioCentavos, 0),
      horasPerdidasF1Min: grupos.reduce((a, g) => a + g.horasPerdidasF1Min, 0),
      horasPerdidasF2Min: grupos.reduce((a, g) => a + g.horasPerdidasF2Min, 0),
      fteF1: arred(grupos.reduce((a, g) => a + g.fteF1, 0)),
      fteF2: arred(grupos.reduce((a, g) => a + g.fteF2, 0)),
    },
  };
}
