import {
  calcularHoras, dataDoNumero, divisorEfetivo, numeroDoDia, resolverRegras, valorHoraCentavos, VERSAO_MOTOR,
  type Alocacao, type ContextoColaborador, type DataISO, type Feriado,
} from '@jc/rules-engine';
import { z } from 'zod';
import { conciliarPonto, type DiaConciliado, type MarcacaoPonto } from './conciliacao';
import { calcularSaldo, valorEstimadoVencido, type Lancamento } from './banco-horas';
import type { EntradaEscala } from './escala-entrada';
import { carregarEntradaEscala } from './escala';
import { chamar, type ClienteRpc } from './rpc';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const baseZ = z.object({
  inicio: data, fim: data,
  colaboradores: z.array(z.object({ id: z.string(), nome: z.string(), matricula: z.string().nullable(), cargo: z.string().nullable(), setor: z.string().nullable(), admissao: data, desligamento: data.nullable() })),
  escalas: z.array(z.object({ id: z.string(), nome: z.string(), versao: z.number().int(), hash: z.string().nullable(), inicio: data, fim: data })),
  ausencias: z.array(z.object({ colaboradorId: z.string(), inicio: data, fim: data, tipo: z.enum(['ferias', 'afastamento']) })),
  banco: z.array(z.object({
    id: z.number().int(), colaborador_id: z.string(), data, minutos: z.number().int(), origem: z.enum(['manual', 'compensacao', 'falta', 'ajuste', 'pagamento', 'estorno', 'ponto', 'escala']),
    descricao: z.string().nullable(), vence_em: data.nullable(), estorna_id: z.number().int().nullable(), criado_em: z.string(),
  })),
  versao_vigente: z.number().int().nullable(),
});
export type BaseFechamento = Omit<z.infer<typeof baseZ>, 'banco'> & { banco: Lancamento[] };

export type SeveridadeAviso = 'bloqueio' | 'alerta' | 'info';
export type AvisoFechamento = { codigo: 'SEM_ESCALA' | 'MES_PARCIAL' | 'SEM_MATRICULA' | 'SEM_CONTRATO' | 'VENCIDO_A_PAGAR' | 'ORIGEM_ESCALA' | 'ORIGEM_PONTO' | 'PONTO_SEM_IMPORTACAO' | 'PONTO_SEM_MARCACAO' | 'PONTO_PENDENTE' | 'PONTO_EM_AUSENCIA' | 'PONTO_EM_FOLGA'; severidade: SeveridadeAviso; mensagem: string };

export type LinhaFechamento = {
  colaboradorId: string; nome: string; matricula: string | null; cargo: string | null; setor: string | null;
  temContrato: boolean;
  diasTrabalhados: number; trabalhadasMin: number; normaisMin: number; extrasMin: number; adicionalHePercentual: number;
  noturnasRelogioMin: number; noturnasComputadasMin: number; domingoMin: number; feriadoMin: number; domingosTrabalhados: number; feriadosTrabalhados: number;
  faltasMin: number; diasFerias: number; diasAfastamento: number;
  /** Só no fechamento pelo ponto: dias previstos sem marcação, dias com marcação incompleta, horas descontadas por falta de marcação e dias em que o ponto mudou o previsto. */
  diasSemMarcacao: number; diasPendentes: number; faltasPontoMin: number; diasAjustadosPeloPonto: number;
  bancoCreditoMin: number; bancoDebitoMin: number; bancoPagoMin: number; bancoSaldoFinalMin: number; bancoVencidoMin: number; bancoAVencerMin: number; valorVencidoCentavos: number;
};
export type Fechamento = {
  competencia: string; inicio: DataISO; fim: DataISO; origem: 'escala' | 'ponto'; /** Só no ponto: o que fazer com dia previsto sem nenhuma marcação. */ semMarcacao?: 'escala' | 'falta'; motor: string;
  linhas: LinhaFechamento[]; avisos: AvisoFechamento[];
  escalas: BaseFechamento['escalas'];
  totais: { colaboradores: number; trabalhadasMin: number; extrasMin: number; noturnasComputadasMin: number; faltasMin: number; faltasPontoMin: number; bancoVencidoMin: number; valorVencidoCentavos: number };
};

export function lerBaseFechamento(json: unknown): BaseFechamento {
  const b = baseZ.parse(json);
  return { ...b, banco: b.banco };
}

/** Lê a base do mês e a entrada de cada escala publicada que o cobre. */
export async function carregarBaseFechamento(cliente: ClienteRpc, empresaId: string, competencia: DataISO): Promise<{ base: BaseFechamento; entradas: EntradaEscala[] }> {
  const base = lerBaseFechamento(await chamar(cliente, 'fechamento_entrada', { p_empresa: empresaId, p_competencia: competencia }));
  const entradas: EntradaEscala[] = [];
  for (const e of base.escalas) entradas.push(await carregarEntradaEscala(cliente, e.id));
  return { base, entradas };
}

const diasDoMes = (ini: DataISO, fim: DataISO): DataISO[] => Array.from({ length: numeroDoDia(fim) - numeroDoDia(ini) + 1 }, (_, i) => dataDoNumero(numeroDoDia(ini) + i));

export type OpcoesFechamento = {
  /** 'escala': horas previstas na escala publicada. 'ponto': horas apuradas pelas marcações do relógio. */
  origem: 'escala' | 'ponto';
  /** Marcações já vinculadas a colaboradores, do mês e um dia a mais nas pontas (turno que vira a noite). */
  marcacoes?: MarcacaoPonto[];
  /** Dia previsto sem nenhuma marcação: 'escala' conta como trabalhado (ponto ainda não tratado); 'falta' desconta. */
  semMarcacao?: 'escala' | 'falta';
};

type Contagem = { semMarcacao: number; pendentes: number; faltaMin: number; ajustados: number; emFolga: number; emAusencia: number };
const novaContagem = (): Contagem => ({ semMarcacao: 0, pendentes: 0, faltaMin: 0, ajustados: 0, emFolga: 0, emAusencia: 0 });
const MUDA_O_PREVISTO = new Set(['ATRASO', 'SAIDA_ANTECIPADA', 'HORA_EXTRA_REALIZADA', 'INTERVALO_REDUZIDO']);

/**
 * Horas efetivas do mês pelo ponto. Regras:
 * - dia dentro da tolerância da CLT (art. 58 §1º): vale o previsto na escala;
 * - atraso, saída antecipada, tempo além do turno ou intervalo menor: valem as marcações (primeira entrada → última saída,
 *   descontando as pausas marcadas; com só entrada e saída, o intervalo previsto na escala, que é pré-assinalado);
 * - dia previsto sem marcação: segue a opção (previsto ou falta); marcação incompleta (ímpar) nunca desconta, vale o previsto e fica como pendência;
 * - marcação em dia de folga: conta como trabalhado (se completa); em férias/afastamento não conta.
 */
function alocacoesPeloPonto(e: EntradaEscala, dias: DiaConciliado[], semMarcacao: 'escala' | 'falta', noMes: (d: DataISO) => boolean, cont: Map<string, Contagem>): Alocacao[] {
  const c = (id: string) => cont.get(id) ?? cont.set(id, novaContagem()).get(id)!;
  const out: Alocacao[] = e.alocacoes.filter((a) => a.tipo !== 'trabalho' && noMes(a.data));
  const previstos = e.alocacoes.filter((a) => a.tipo === 'trabalho' && a.inicioMin != null && a.fimMin != null && noMes(a.data)).sort((a, b) => a.inicioMin! - b.inicioMin!);
  const porDia = new Map<string, DiaConciliado[]>();
  for (const d of dias) if (d.previstoLiquidoMin > 0) porDia.set(`${d.colaboradorId}|${d.data}`, [...(porDia.get(`${d.colaboradorId}|${d.data}`) ?? []), d]);
  const usados = new Map<string, number>();
  for (const a of previstos) {
    const k = `${a.colaboradorId}|${a.data}`, i = usados.get(k) ?? 0; usados.set(k, i + 1);
    const d = porDia.get(k)?.[i];
    // dia de férias/afastamento lançado: não é falta de marcação
    if (!d || e.ausencias.some((x) => x.colaboradorId === a.colaboradorId && a.data >= x.inicio && a.data <= x.fim)) { out.push(a); continue; }
    if (d.codigos.includes('SEM_MARCACAO')) {
      c(a.colaboradorId).semMarcacao++;
      if (semMarcacao === 'falta') { c(a.colaboradorId).faltaMin += d.previstoLiquidoMin; continue; }
      out.push(a); continue;
    }
    if (d.codigos.includes('MARCACAO_IMPAR')) { c(a.colaboradorId).pendentes++; out.push(a); continue; }
    if (d.codigos.some((x) => MUDA_O_PREVISTO.has(x)) && d.entradaRealMin != null && d.saidaRealMin != null) {
      const ini = Math.max(0, d.entradaRealMin), fim = Math.min(2879, d.saidaRealMin);
      if (fim > ini) {
        out.push({ ...a, inicioMin: ini, fimMin: fim, intervaloMin: Math.min(d.pausasRealMin > 0 ? d.pausasRealMin : (a.intervaloMin ?? 0), fim - ini - 1) });
        c(a.colaboradorId).ajustados++; continue;
      }
    }
    out.push(a);
  }
  for (const d of dias) {
    if (d.previstoLiquidoMin > 0 || !noMes(d.data)) continue;
    if (d.codigos.includes('MARCACAO_EM_AUSENCIA')) { c(d.colaboradorId).emAusencia++; continue; }
    if (d.entradaRealMin == null || d.saidaRealMin == null) { c(d.colaboradorId).pendentes++; continue; }
    const ini = Math.max(0, d.entradaRealMin), fim = Math.min(2879, d.saidaRealMin);
    if (fim <= ini) continue;
    c(d.colaboradorId).emFolga++;
    out.push({ colaboradorId: d.colaboradorId, data: d.data, tipo: 'trabalho', inicioMin: ini, fimMin: fim, intervaloMin: Math.min(d.pausasRealMin, fim - ini - 1) } as Alocacao);
  }
  return out;
}

/**
 * Fechamento do mês pelas escalas PUBLICADAS. Por padrão as horas são as previstas na escala; com `origem: 'ponto'` são as apuradas pelas marcações.
 * Semana que atravessa o mês conta só os dias do mês (o extra semanal das pontas é calculado com o que está dentro do mês).
 */
export function calcularFechamento(base: BaseFechamento, entradas: EntradaEscala[], opcoes: OpcoesFechamento = { origem: 'escala' }): Fechamento {
  const { inicio, fim } = base;
  const peloPonto = opcoes.origem === 'ponto';
  const semMarcacao = opcoes.semMarcacao ?? 'escala';
  const contagens = new Map<string, Contagem>();
  const dias = diasDoMes(inicio, fim);
  const noMes = (d: DataISO) => d >= inicio && d <= fim;
  const ctxs = new Map<string, ContextoColaborador>();
  const regras = entradas[0]?.regras ?? [];
  const feriadosMap = new Map<DataISO, Feriado>();
  const aloc = new Map<string, Alocacao[]>();
  const vistos = new Set<string>();
  const coberto = new Set<DataISO>();
  for (const e of entradas) {
    for (const c of e.colaboradores) if (!ctxs.has(c.colaboradorId)) ctxs.set(c.colaboradorId, c);
    for (const f of e.feriados) feriadosMap.set(f.data, f);
    for (const d of diasDoMes(e.escala.inicio, e.escala.fim)) if (noMes(d)) coberto.add(d);
    const efetivas = peloPonto
      ? alocacoesPeloPonto(e, conciliarPonto({ ...e, escala: { ...e.escala, inicio: e.escala.inicio < inicio ? inicio : e.escala.inicio, fim: e.escala.fim > fim ? fim : e.escala.fim } }, opcoes.marcacoes ?? []).dias, semMarcacao, noMes, contagens)
      : e.alocacoes;
    for (const a of efetivas) {
      if (!noMes(a.data)) continue;
      const k = `${a.colaboradorId}|${a.data}|${a.tipo}|${a.inicioMin ?? ''}|${a.fimMin ?? ''}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      aloc.set(a.colaboradorId, [...(aloc.get(a.colaboradorId) ?? []), a]);
    }
  }
  const feriados = [...feriadosMap.values()];
  const estornados = new Set(base.banco.filter((l) => l.estorna_id != null).map((l) => l.estorna_id!));

  const linhas: LinhaFechamento[] = base.colaboradores.map((c) => {
    const ctx = ctxs.get(c.id);
    const meus = aloc.get(c.id) ?? [];
    const lancs = base.banco.filter((l) => l.colaborador_id === c.id);
    const doMes = lancs.filter((l) => noMes(l.data));
    const saldo = calcularSaldo(lancs, fim);
    let horas = { trabalhadasMin: 0, normaisMin: 0, extrasMin: 0, noturnasRelogioMin: 0, noturnasComputadasMin: 0, domingoMin: 0, feriadoMin: 0, diasTrabalhados: 0, domingosTrabalhados: 0, feriadosTrabalhados: 0 };
    let adicional = 50, valorVencido = 0;
    if (ctx) {
      const r0 = resolverRegras(ctx, inicio, regras);
      const comp = r0.regimeCompensatorio && ctx.tipoEscala === r0.regimeCompensatorio.escala;
      horas = calcularHoras(meus, feriados, {
        maxDiariaMin: comp ? r0.regimeCompensatorio!.maxDiariaMin : r0.maxDiariaMin,
        maxSemanalMin: (d) => resolverRegras(ctx, d, regras).maxSemanalMin, periodo: { inicio, fim },
      });
      adicional = r0.adicionalHePercentual;
      if (saldo.vencidoMin > 0) valorVencido = valorEstimadoVencido(saldo.vencidoMin, valorHoraCentavos(ctx.salarioBaseCentavos, divisorEfetivo(r0, ctx)), adicional);
    }
    const diasAus = (tipo: 'ferias' | 'afastamento') => new Set(base.ausencias.filter((a) => a.colaboradorId === c.id && a.tipo === tipo).flatMap((a) => dias.filter((d) => d >= a.inicio && d <= a.fim))).size;
    return {
      colaboradorId: c.id, nome: c.nome, matricula: c.matricula, cargo: c.cargo, setor: c.setor, temContrato: !!ctx,
      diasTrabalhados: horas.diasTrabalhados, trabalhadasMin: horas.trabalhadasMin, normaisMin: horas.normaisMin, extrasMin: horas.extrasMin, adicionalHePercentual: adicional,
      noturnasRelogioMin: horas.noturnasRelogioMin, noturnasComputadasMin: horas.noturnasComputadasMin, domingoMin: horas.domingoMin, feriadoMin: horas.feriadoMin,
      domingosTrabalhados: horas.domingosTrabalhados, feriadosTrabalhados: horas.feriadosTrabalhados,
      faltasMin: doMes.filter((l) => l.origem === 'falta' && !estornados.has(l.id)).reduce((s, l) => s - l.minutos, 0),
      diasFerias: diasAus('ferias'), diasAfastamento: diasAus('afastamento'),
      diasSemMarcacao: contagens.get(c.id)?.semMarcacao ?? 0, diasPendentes: contagens.get(c.id)?.pendentes ?? 0, faltasPontoMin: contagens.get(c.id)?.faltaMin ?? 0, diasAjustadosPeloPonto: contagens.get(c.id)?.ajustados ?? 0,
      bancoCreditoMin: doMes.filter((l) => l.minutos > 0).reduce((s, l) => s + l.minutos, 0), bancoDebitoMin: doMes.filter((l) => l.minutos < 0 && l.origem !== 'pagamento').reduce((s, l) => s - l.minutos, 0),
      bancoPagoMin: doMes.filter((l) => l.origem === 'pagamento').reduce((s, l) => s - l.minutos, 0),
      bancoSaldoFinalMin: saldo.saldoMin, bancoVencidoMin: saldo.vencidoMin, bancoAVencerMin: saldo.aVencerMin, valorVencidoCentavos: valorVencido,
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const avisos: AvisoFechamento[] = peloPonto
    ? [{ codigo: 'ORIGEM_PONTO', severidade: 'info', mensagem: `As horas vêm do ponto apurado (marcações do relógio). Variações de até 5 min por marcação (10 min por dia) valem o horário da escala; acima disso valem as marcações. Dia previsto sem marcação: ${semMarcacao === 'falta' ? 'descontado como falta' : 'contado como previsto na escala'}.` }]
    : [{ codigo: 'ORIGEM_ESCALA', severidade: 'info', mensagem: 'As horas vêm da escala publicada (previstas), não do ponto. Confira faltas e horas extras reais antes de enviar à folha, ou feche pelo ponto apurado.' }];
  if (entradas.length === 0) avisos.unshift({ codigo: 'SEM_ESCALA', severidade: 'bloqueio', mensagem: 'Nenhuma escala publicada cobre este mês: não há horas para fechar.' });
  else {
    const faltam = dias.filter((d) => !coberto.has(d)).length;
    if (faltam > 0) avisos.push({ codigo: 'MES_PARCIAL', severidade: 'alerta', mensagem: `${faltam} dia(s) do mês não estão em nenhuma escala publicada; as horas desses dias não entram.` });
  }
  if (peloPonto) {
    const soma = (f: (c: Contagem) => number) => [...contagens.values()].reduce((t, c) => t + f(c), 0);
    if ((opcoes.marcacoes ?? []).length === 0) avisos.unshift({ codigo: 'PONTO_SEM_IMPORTACAO', severidade: 'bloqueio', mensagem: 'Não há nenhuma marcação de ponto importada para este mês: importe o AFD em Ponto (AFD) ou feche pela escala.' });
    const sem = soma((c) => c.semMarcacao), pend = soma((c) => c.pendentes), folga = soma((c) => c.emFolga), aus = soma((c) => c.emAusencia);
    if (sem > 0) avisos.push({ codigo: 'PONTO_SEM_MARCACAO', severidade: 'alerta', mensagem: `${sem} dia(s) previstos na escala sem nenhuma marcação (possível falta, atestado ou ponto não importado) — ${semMarcacao === 'falta' ? 'descontados como falta' : 'contados como previstos'}. Confira em Ponto (AFD).` });
    if (pend > 0) avisos.push({ codigo: 'PONTO_PENDENTE', severidade: 'alerta', mensagem: `${pend} dia(s) com marcação incompleta (número ímpar de marcações): valeu o horário previsto na escala. Corrija o ponto e refaça o fechamento se necessário.` });
    if (folga > 0) avisos.push({ codigo: 'PONTO_EM_FOLGA', severidade: 'info', mensagem: `${folga} dia(s) com marcação em dia de folga: as horas trabalhadas entraram no fechamento.` });
    if (aus > 0) avisos.push({ codigo: 'PONTO_EM_AUSENCIA', severidade: 'alerta', mensagem: `${aus} dia(s) com marcação durante férias ou afastamento: não entraram no fechamento; confira o lançamento da ausência.` });
  }
  const semMat = linhas.filter((l) => !l.matricula && l.trabalhadasMin > 0);
  if (semMat.length > 0) avisos.push({ codigo: 'SEM_MATRICULA', severidade: 'alerta', mensagem: `${semMat.length} colaborador(es) com horas e sem matrícula cadastrada (a folha costuma identificar por matrícula): ${semMat.slice(0, 5).map((l) => l.nome).join(', ')}${semMat.length > 5 ? '…' : ''}.` });
  const semCont = linhas.filter((l) => !l.temContrato);
  if (semCont.length > 0) avisos.push({ codigo: 'SEM_CONTRATO', severidade: 'alerta', mensagem: `${semCont.length} colaborador(es) sem contrato vigente no mês, sem horas calculadas: ${semCont.slice(0, 5).map((l) => l.nome).join(', ')}${semCont.length > 5 ? '…' : ''}.` });
  const venc = linhas.reduce((s, l) => s + l.bancoVencidoMin, 0);
  if (venc > 0) avisos.push({ codigo: 'VENCIDO_A_PAGAR', severidade: 'alerta', mensagem: `${Math.floor(venc / 60)}h${String(venc % 60).padStart(2, '0')} de banco de horas vencidas a pagar como hora extra. Registre o pagamento no banco de horas depois de enviar à folha.` });

  const soma = (f: (l: LinhaFechamento) => number) => linhas.reduce((s, l) => s + f(l), 0);
  return {
    competencia: inicio.slice(0, 7), inicio, fim, origem: opcoes.origem, ...(peloPonto ? { semMarcacao } : {}), motor: VERSAO_MOTOR, linhas, avisos, escalas: base.escalas,
    totais: { colaboradores: linhas.length, trabalhadasMin: soma((l) => l.trabalhadasMin), extrasMin: soma((l) => l.extrasMin), noturnasComputadasMin: soma((l) => l.noturnasComputadasMin), faltasMin: soma((l) => l.faltasMin), faltasPontoMin: soma((l) => l.faltasPontoMin), bancoVencidoMin: venc, valorVencidoCentavos: soma((l) => l.valorVencidoCentavos) },
  };
}

export const podeFechar = (f: Fechamento): boolean => !f.avisos.some((a) => a.severidade === 'bloqueio') && f.linhas.length > 0;

/** Fecha o mês (versão nova se já houver). O servidor já calculou; o banco confere permissão, mês encerrado e motivo da reabertura. */
export async function fecharFolha(cliente: ClienteRpc, empresaId: string, f: Fechamento, motivo?: string): Promise<string> {
  if (!podeFechar(f)) throw new Error('Este mês não pode ser fechado: resolva os bloqueios.');
  const id = await chamar(cliente, 'fechar_folha', { p_empresa: empresaId, p_competencia: f.inicio, p_dados: f, p_motivo: motivo ?? null });
  if (typeof id !== 'string') throw new Error('Falha ao fechar o mês.');
  return id;
}
