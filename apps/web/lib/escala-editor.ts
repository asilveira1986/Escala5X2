import { dataDoNumero, diaDaSemana, hhmm, numeroDoDia, type Alocacao, type DataISO, type Severidade, type Violacao } from '@jc/rules-engine';

/** Alocação da grade: o motor ignora `modeloId`; ele só serve para gravar a ligação com o modelo de turno. */
export type Celula = Alocacao & { modeloId?: string | null };
export type Modelo = { id: string; nome: string; inicioMin: number; fimMin: number; intervaloMin: number; cor: string };
export type Pincel = { tipo: 'modelo'; modelo: Modelo } | { tipo: 'folga' } | { tipo: 'limpar' };

export const chave = (colaboradorId: string, data: DataISO) => `${colaboradorId}|${data}`;

export function diasDoPeriodo(inicio: DataISO, fim: DataISO): DataISO[] {
  const a = numeroDoDia(inicio), b = numeroDoDia(fim);
  return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => dataDoNumero(a + i));
}

export function indexar(alocacoes: Celula[]): Map<string, Celula[]> {
  const m = new Map<string, Celula[]>();
  for (const a of alocacoes) {
    const k = chave(a.colaboradorId, a.data);
    m.set(k, [...(m.get(k) ?? []), a]);
  }
  return m;
}

/** Aplica o pincel numa célula: o conteúdo anterior é substituído (modelo/folga) ou apagado (limpar). */
export function aplicarPincel(alocacoes: Celula[], colaboradorId: string, data: DataISO, pincel: Pincel): Celula[] {
  const resto = alocacoes.filter((a) => !(a.colaboradorId === colaboradorId && a.data === data));
  if (pincel.tipo === 'limpar') return resto;
  if (pincel.tipo === 'folga') return [...resto, { colaboradorId, data, tipo: 'folga' }];
  const m = pincel.modelo;
  return [...resto, { colaboradorId, data, tipo: 'trabalho', inicioMin: m.inicioMin, fimMin: m.fimMin, intervaloMin: m.intervaloMin, modeloId: m.id }];
}

/**
 * Repete o padrão da primeira semana (7 dias a partir do início do período) nas semanas seguintes.
 * Células fora do padrão (dias depois da primeira semana) são substituídas; a primeira semana fica como está.
 */
export function repetirPrimeiraSemana(alocacoes: Celula[], inicio: DataISO, fim: DataISO): Celula[] {
  const base = numeroDoDia(inicio), ultimo = numeroDoDia(fim);
  const primeira = alocacoes.filter((a) => numeroDoDia(a.data) < base + 7);
  const saida: Celula[] = [...primeira];
  for (let n = base + 7; n <= ultimo; n++) {
    const molde = primeira.filter((a) => numeroDoDia(a.data) === base + ((n - base) % 7));
    for (const a of molde) saida.push({ ...a, data: dataDoNumero(n) });
  }
  return saida;
}

export function contarTrabalhando(alocacoes: Celula[], dias: DataISO[]): number[] {
  const por = new Map<DataISO, Set<string>>();
  for (const a of alocacoes) if (a.tipo === 'trabalho') por.set(a.data, (por.get(a.data) ?? new Set()).add(a.colaboradorId));
  return dias.map((d) => por.get(d)?.size ?? 0);
}

const ordem: Record<Severidade, number> = { bloqueio: 0, alerta: 1, info: 2 };
/** Pior severidade por célula (colaborador+dia), para colorir a grade. */
export function severidadePorCelula(violacoes: Violacao[]): Map<string, Severidade> {
  const m = new Map<string, Severidade>();
  for (const v of violacoes) {
    if (!v.colaboradorId || !v.data) continue;
    const k = chave(v.colaboradorId, v.data);
    const atual = m.get(k);
    if (!atual || ordem[v.severidade] < ordem[atual]) m.set(k, v.severidade);
  }
  return m;
}

export const faixaHoras = (c: Pick<Alocacao, 'inicioMin' | 'fimMin'>) => `${hhmm(c.inicioMin ?? 0)}–${hhmm(c.fimMin ?? 0)}`;

export function rotuloCelula(itens: Celula[]): { curto: string; longo: string } {
  if (itens.length === 0) return { curto: '', longo: 'Sem lançamento' };
  if (itens.length > 1) return { curto: `${itens.length}×`, longo: itens.map((i) => (i.tipo === 'trabalho' ? faixaHoras(i) : i.tipo)).join(' e ') };
  const i = itens[0]!;
  switch (i.tipo) {
    case 'trabalho': return { curto: hhmm(i.inicioMin ?? 0), longo: `Trabalho ${faixaHoras(i)}${i.intervaloMin ? `, intervalo ${i.intervaloMin} min` : ''}` };
    case 'folga': return { curto: 'F', longo: 'Folga' };
    case 'dsr': return { curto: 'D', longo: 'Descanso semanal' };
    case 'ferias': return { curto: 'Fér', longo: 'Férias' };
    case 'afastamento': return { curto: 'Afa', longo: 'Afastamento' };
    case 'feriado': return { curto: 'Fer', longo: 'Feriado' };
  }
}

export const ehFimDeSemana = (d: DataISO) => { const s = diaDaSemana(d); return s === 0 || s === 6; };

/** Formato aceito por `salvar_alocacoes`. */
export function paraGravacao(alocacoes: Celula[]) {
  return alocacoes.map((a) => ({
    colaboradorId: a.colaboradorId, data: a.data, tipo: a.tipo,
    inicioMin: a.inicioMin ?? null, fimMin: a.fimMin ?? null, intervaloMin: a.intervaloMin ?? 0, turnoModeloId: a.modeloId ?? null,
  }));
}

export const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/** Dias (por colaborador) em que há férias/afastamento dentro do período mostrado. */
export function ausenciasPorCelula(ausencias: Array<{ colaboradorId: string; inicio: DataISO; fim: DataISO; tipo: 'ferias' | 'afastamento' }>, dias: DataISO[]): Map<string, 'ferias' | 'afastamento'> {
  const m = new Map<string, 'ferias' | 'afastamento'>();
  for (const a of ausencias) for (const d of dias) if (d >= a.inicio && d <= a.fim) m.set(chave(a.colaboradorId, d), a.tipo);
  return m;
}

/** Dias com cobertura abaixo do mínimo (alerta COBERTURA_MINIMA), para destacar na linha "Pessoas trabalhando". */
export function diasComCoberturaBaixa(violacoes: Violacao[]): Set<DataISO> {
  return new Set(violacoes.filter((v) => v.codigo === 'COBERTURA_MINIMA' && v.data).map((v) => v.data!));
}
