import { dataBr, type Alocacao, type DataISO, type Violacao } from '@jc/rules-engine';
import type { AlocacaoComModelo, EntradaEscala } from './escala-entrada';
import { carregarEntradaEscala, publicarEscala, validarEntrada } from './escala';
import { chamar, ErroServico, type ClienteRpc } from './rpc';

export type TipoSolicitacao = 'troca_turno' | 'troca_folga' | 'ferias' | 'afastamento';
export type StatusSolicitacao = 'aguardando_colega' | 'pendente' | 'aprovada' | 'recusada' | 'cancelada';
export type PayloadTrocaTurno = { escalaId: string; dataSolicitante: DataISO; dataColega: DataISO };
export type PayloadTrocaFolga = { escalaId: string; trabalharEm: DataISO; folgarEm: DataISO };
export type PayloadAusencia = { inicio: DataISO; fim: DataISO };

/** Linha de `solicitacao` como o banco devolve. */
export type SolicitacaoLinha = {
  id: string; empresa_id: string; solicitante_id: string; destinatario_id: string | null; solicitante_nome: string; destinatario_nome: string | null;
  tipo: TipoSolicitacao; payload: Record<string, unknown>; motivo: string | null; status: StatusSolicitacao;
  decisao_motivo: string | null; criado_em: string;
};

const ehTrabalho = (a: Alocacao) => a.tipo === 'trabalho';
/** Chave de uma violação. Problemas de semana são identificados pela semana (o dia em que aparecem muda quando o turno muda de dia). */
const dossel = (v: Violacao) => `${v.codigo}|${v.colaboradorId ?? ''}|${(v.detalhe as { semana?: string }).semana ?? v.data ?? ''}`;

export type ResultadoAplicacao = { ok: true; alocacoes: AlocacaoComModelo[]; resumo: string } | { ok: false; erro: string };

/**
 * Aplica o pedido de troca à lista de alocações (sem gravar nada). Confere se o estado atual ainda é o do pedido:
 * se o turno mudou desde que o colaborador pediu, a troca não vale mais.
 */
export function aplicarTroca(alocacoes: AlocacaoComModelo[], s: Pick<SolicitacaoLinha, 'tipo' | 'payload' | 'solicitante_id' | 'destinatario_id' | 'solicitante_nome' | 'destinatario_nome'>): ResultadoAplicacao {
  const A = s.solicitante_id, B = s.destinatario_id;
  const doDia = (c: string, d: DataISO) => alocacoes.filter((a) => a.colaboradorId === c && a.data === d);
  const turnoUnico = (c: string, d: DataISO) => { const t = doDia(c, d).filter(ehTrabalho); return t.length === 1 ? t[0]! : null; };
  const comoTurno = (t: AlocacaoComModelo, c: string, d: DataISO): AlocacaoComModelo => ({ colaboradorId: c, data: d, tipo: 'trabalho', inicioMin: t.inicioMin, fimMin: t.fimMin, intervaloMin: t.intervaloMin ?? 0, ...(t.modeloId ? { modeloId: t.modeloId } : {}) });
  const folga = (c: string, d: DataISO): AlocacaoComModelo => ({ colaboradorId: c, data: d, tipo: 'folga' });
  const semCelulas = (cels: Array<[string, DataISO]>) => alocacoes.filter((a) => !cels.some(([c, d]) => a.colaboradorId === c && a.data === d));

  if (s.tipo === 'troca_turno') {
    const p = s.payload as PayloadTrocaTurno;
    if (!B) return { ok: false, erro: 'Pedido de troca sem colega.' };
    const dA = p.dataSolicitante, dB = p.dataColega;
    const tA = turnoUnico(A, dA), tB = turnoUnico(B, dB);
    if (!tA) return { ok: false, erro: `${s.solicitante_nome} não tem mais um turno único em ${dataBr(dA)}: a escala mudou desde o pedido.` };
    if (!tB) return { ok: false, erro: `${s.destinatario_nome ?? 'O colega'} não tem mais um turno único em ${dataBr(dB)}: a escala mudou desde o pedido.` };
    if (dA === dB) {
      return { ok: true, resumo: `${s.solicitante_nome} e ${s.destinatario_nome} trocam de turno em ${dataBr(dA)}.`, alocacoes: [...semCelulas([[A, dA], [B, dA]]), comoTurno(tB, A, dA), comoTurno(tA, B, dA)] };
    }
    if (doDia(B, dA).some(ehTrabalho)) return { ok: false, erro: `${s.destinatario_nome ?? 'O colega'} já trabalha em ${dataBr(dA)}.` };
    if (doDia(A, dB).some(ehTrabalho)) return { ok: false, erro: `${s.solicitante_nome} já trabalha em ${dataBr(dB)}.` };
    return {
      ok: true, resumo: `${s.destinatario_nome} assume o turno de ${dataBr(dA)} de ${s.solicitante_nome}, que assume o de ${dataBr(dB)}.`,
      alocacoes: [...semCelulas([[A, dA], [B, dB], [B, dA], [A, dB]]), comoTurno(tA, B, dA), comoTurno(tB, A, dB), folga(A, dA), folga(B, dB)],
    };
  }
  if (s.tipo === 'troca_folga') {
    const p = s.payload as PayloadTrocaFolga;
    const t = turnoUnico(A, p.folgarEm);
    if (!t) return { ok: false, erro: `${s.solicitante_nome} não tem mais um turno único em ${dataBr(p.folgarEm)}: a escala mudou desde o pedido.` };
    if (doDia(A, p.trabalharEm).some(ehTrabalho)) return { ok: false, erro: `${s.solicitante_nome} já trabalha em ${dataBr(p.trabalharEm)}.` };
    return {
      ok: true, resumo: `${s.solicitante_nome} folga em ${dataBr(p.folgarEm)} e trabalha em ${dataBr(p.trabalharEm)}.`,
      alocacoes: [...semCelulas([[A, p.folgarEm], [A, p.trabalharEm]]), comoTurno(t, A, p.trabalharEm), folga(A, p.folgarEm)],
    };
  }
  return { ok: false, erro: 'Este tipo de pedido não altera turnos.' };
}

export type Impacto = {
  /** Violações que NÃO existiam antes da mudança. */
  novas: Violacao[]; resolvidas: number; bloqueios: number; alertas: number;
};

/** Compara a escala antes e depois: só o que a mudança introduz importa (o que já estava errado não é culpa do pedido). */
export function analisarImpacto(entrada: EntradaEscala, depois: AlocacaoComModelo[]): Impacto {
  const antes = new Set(validarEntrada(entrada, entrada.alocacoes).violacoes.map(dossel));
  const vd = validarEntrada(entrada, depois).violacoes;
  const novas = vd.filter((v) => !antes.has(dossel(v)));
  const dep = new Set(vd.map(dossel));
  return {
    novas, resolvidas: [...antes].filter((k) => !dep.has(k)).length,
    bloqueios: novas.filter((v) => v.severidade === 'bloqueio').length, alertas: novas.filter((v) => v.severidade === 'alerta').length,
  };
}

/** Turnos de trabalho da pessoa dentro do período de férias/afastamento: conflito com a escala já montada. */
export function turnosEmConflito(entrada: EntradaEscala, colaboradorId: string, p: PayloadAusencia): DataISO[] {
  return entrada.alocacoes.filter((a) => a.colaboradorId === colaboradorId && ehTrabalho(a) && a.data >= p.inicio && a.data <= p.fim).map((a) => a.data).sort();
}

export type RelatorioDecisao = { resumo: string; bloqueios: number; alertas: number; violacoes: Array<{ codigo: string; severidade: string; mensagem: string }>; novaEscalaId?: string };
export type ResultadoDecisao = { ok: true; relatorio: RelatorioDecisao; novaEscalaId?: string } | { ok: false; erro: string; impacto?: Impacto };

const resumoViolacoes = (v: Violacao[]) => v.slice(0, 20).map((x) => ({ codigo: x.codigo, severidade: x.severidade, mensagem: x.mensagem }));

/** Pré-visualização para o RH: o que a troca faz e o que ela introduz de problema (não grava nada). */
export async function preverSolicitacao(cliente: ClienteRpc, s: SolicitacaoLinha): Promise<{ resumo: string; impacto: Impacto | null; conflitos: DataISO[]; erro?: string; escalaId?: string }> {
  if (s.tipo === 'ferias' || s.tipo === 'afastamento') {
    const p = s.payload as PayloadAusencia;
    const ids = await chamar(cliente, 'escalas_publicadas_no_periodo', { p_empresa: s.empresa_id, p_inicio: p.inicio, p_fim: p.fim });
    const conflitos: DataISO[] = [];
    for (const id of Array.isArray(ids) ? (ids as string[]) : []) conflitos.push(...turnosEmConflito(await carregarEntradaEscala(cliente, id), s.solicitante_id, p));
    return { resumo: `${s.solicitante_nome}: ${s.tipo === 'ferias' ? 'férias' : 'afastamento'} de ${dataBr(p.inicio)} a ${dataBr(p.fim)}.`, impacto: null, conflitos };
  }
  const escalaId = await chamar(cliente, 'escala_vigente', { p_escala: (s.payload as PayloadTrocaTurno).escalaId });
  if (typeof escalaId !== 'string') return { resumo: '', impacto: null, conflitos: [], erro: 'A escala deste pedido não está mais em vigor.' };
  const entrada = await carregarEntradaEscala(cliente, escalaId);
  const r = aplicarTroca(entrada.alocacoes, s);
  if (!r.ok) return { resumo: '', impacto: null, conflitos: [], erro: r.erro, escalaId };
  return { resumo: r.resumo, impacto: analisarImpacto(entrada, r.alocacoes), conflitos: [], escalaId };
}

const paraGravacao = (alocs: AlocacaoComModelo[]) => alocs.map((a) => ({
  colaboradorId: a.colaboradorId, data: a.data, tipo: a.tipo, inicioMin: a.inicioMin ?? null, fimMin: a.fimMin ?? null, intervaloMin: a.intervaloMin ?? 0, turnoModeloId: a.modeloId ?? null,
}));

/**
 * Aprova uma troca (turno ou folga) pedida em escala publicada: valida o resultado com o motor, cria uma NOVA VERSÃO da escala
 * com a troca, publica (o banco recalcula o hash e marca a anterior como substituída) e registra a decisão.
 * Escala publicada nunca é alterada no lugar. Ordem: efeito primeiro, decisão depois; se o efeito falhar, o pedido continua pendente.
 */
export async function aprovarTroca(cliente: ClienteRpc, servidor: ClienteRpc | null, s: SolicitacaoLinha, usuarioId: string): Promise<ResultadoDecisao> {
  if (s.tipo !== 'troca_turno' && s.tipo !== 'troca_folga') return { ok: false, erro: 'Este pedido não é uma troca de turnos.' };
  if (s.status !== 'pendente') return { ok: false, erro: 'Este pedido não está pendente de decisão.' };
  if (!servidor) return { ok: false, erro: 'A publicação ainda não está habilitada neste ambiente (falta SUPABASE_SERVICE_ROLE_KEY no servidor web).' };
  const vigente = await chamar(cliente, 'escala_vigente', { p_escala: (s.payload as PayloadTrocaTurno).escalaId });
  if (typeof vigente !== 'string') return { ok: false, erro: 'A escala deste pedido não está mais em vigor.' };
  const entrada = await carregarEntradaEscala(cliente, vigente);
  const r = aplicarTroca(entrada.alocacoes, s);
  if (!r.ok) return { ok: false, erro: r.erro };
  const impacto = analisarImpacto(entrada, r.alocacoes);
  if (impacto.bloqueios > 0) return { ok: false, erro: `A troca violaria a lei: ${impacto.novas.find((v) => v.severidade === 'bloqueio')!.mensagem}`, impacto };

  const rascunho = await chamar(cliente, 'criar_versao_rascunho', { p_escala: vigente });
  if (typeof rascunho !== 'string') return { ok: false, erro: 'Não foi possível criar a nova versão da escala.' };
  const descartar = () => chamar(cliente, 'descartar_versao_rascunho', { p_escala: rascunho }).then(() => undefined, () => undefined);
  try {
    const nova = await carregarEntradaEscala(cliente, rascunho);
    await chamar(cliente, 'salvar_alocacoes', { p_escala: rascunho, p_revisao: nova.escala.revisao, p_alocacoes: paraGravacao(r.alocacoes) });
    await publicarEscala(cliente, servidor, rascunho, usuarioId);
  } catch (e) {
    await descartar();
    return { ok: false, erro: e instanceof ErroServico ? e.message : 'Não foi possível publicar a nova versão da escala.' };
  }
  const relatorio: RelatorioDecisao = { resumo: r.resumo, bloqueios: 0, alertas: impacto.alertas, violacoes: resumoViolacoes(impacto.novas), novaEscalaId: rascunho };
  try {
    await chamar(cliente, 'decidir_solicitacao', { p_id: s.id, p_aprovar: true, p_motivo: null, p_validacao: relatorio });
  } catch (e) {
    return { ok: false, erro: `A nova versão da escala foi publicada, mas o pedido não pôde ser marcado como aprovado (${e instanceof ErroServico ? e.message : 'erro'}). Confira a lista de escalas.` };
  }
  return { ok: true, relatorio, novaEscalaId: rascunho };
}

/** Férias e afastamento: o banco lança a ausência e a decisão na mesma transação. */
export async function aprovarAusencia(cliente: ClienteRpc, s: SolicitacaoLinha, conflitos: DataISO[] = []): Promise<ResultadoDecisao> {
  if (s.tipo !== 'ferias' && s.tipo !== 'afastamento') return { ok: false, erro: 'Este pedido não é de férias nem de afastamento.' };
  if (s.status !== 'pendente') return { ok: false, erro: 'Este pedido não está pendente de decisão.' };
  const p = s.payload as PayloadAusencia;
  const relatorio: RelatorioDecisao = {
    resumo: `${s.tipo === 'ferias' ? 'Férias' : 'Afastamento'} de ${dataBr(p.inicio)} a ${dataBr(p.fim)} lançado(a) para ${s.solicitante_nome}.`, bloqueios: 0, alertas: conflitos.length ? 1 : 0,
    violacoes: conflitos.length ? [{ codigo: 'TURNOS_NO_PERIODO', severidade: 'alerta', mensagem: `${conflitos.length} turno(s) já escalado(s) nesse período precisam ser reorganizados.` }] : [],
  };
  try {
    await chamar(cliente, 'decidir_solicitacao', { p_id: s.id, p_aprovar: true, p_motivo: null, p_validacao: relatorio });
  } catch (e) {
    return { ok: false, erro: e instanceof ErroServico && /sobrep|exclu|overlap|conflit/i.test(e.message) ? 'Já existe férias ou afastamento lançado que se sobrepõe a esse período.' : e instanceof ErroServico ? e.message : 'Não foi possível aprovar.' };
  }
  return { ok: true, relatorio };
}

export async function recusarSolicitacao(cliente: ClienteRpc, id: string, motivo: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    await chamar(cliente, 'decidir_solicitacao', { p_id: id, p_aprovar: false, p_motivo: motivo, p_validacao: null });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof ErroServico ? e.message : 'Não foi possível recusar.' };
  }
}
