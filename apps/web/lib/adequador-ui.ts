/** Auxiliares puros da tela do Adequador de escala (horários, carga semanal, sugestão de cobertura). */
export type TurnoBase = { chave: string; nome: string; inicio: string; fim: string; intervalo: number; modeloId: string | null; /** O horário de saída acompanha a jornada escolhida (turnos curtos, tipo meio período, ficam de fora). */ segueJornada?: boolean };
export type TurnoForm = { chave: string; nome: string; inicio: string; fim: string; intervalo: number; modeloId: string | null; minimo: number[] };

/** Ordem dos dias na tela (segunda a domingo) → índice usado pelo motor (0 = domingo). */
export const DIAS_TELA = [
  { rotulo: 'Seg', indice: 1 }, { rotulo: 'Ter', indice: 2 }, { rotulo: 'Qua', indice: 3 }, { rotulo: 'Qui', indice: 4 },
  { rotulo: 'Sex', indice: 5 }, { rotulo: 'Sáb', indice: 6 }, { rotulo: 'Dom', indice: 0 },
] as const;

export const minutosDeHora = (h: string): number | null => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(h.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const horaDeMinutos = (min: number): string => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Horas líquidas do turno (termina no dia seguinte quando o fim é menor ou igual ao início). Null se o horário for inválido. */
export function liquidoDoTurno(t: Pick<TurnoForm, 'inicio' | 'fim' | 'intervalo'>): number | null {
  const i = minutosDeHora(t.inicio), f = minutosDeHora(t.fim);
  if (i === null || f === null) return null;
  const fim = f <= i ? f + 1440 : f;
  const liq = fim - i - t.intervalo;
  return liq > 0 ? liq : null;
}

export const horasTexto = (min: number): string => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

/** Quantas pessoas a cobertura pede por semana (soma de dias × pessoas) e quantas a equipe cobre com X dias de trabalho por semana. */
export function balancoDaEquipe(turnos: Pick<TurnoForm, 'minimo'>[], pessoas: number, diasPorSemana: number): { posicoesSemana: number; capacidadeSemana: number; pessoasNecessarias: number; sobra: number } {
  const posicoesSemana = turnos.reduce((s, t) => s + t.minimo.reduce((a, b) => a + b, 0), 0);
  const capacidadeSemana = pessoas * diasPorSemana;
  const pessoasNecessarias = diasPorSemana > 0 ? Math.ceil(posicoesSemana / diasPorSemana) : 0;
  return { posicoesSemana, capacidadeSemana, pessoasNecessarias, sobra: pessoas - pessoasNecessarias };
}

/** Cobertura sugerida: divide a equipe entre os turnos e os dias de trabalho (arredonda para baixo, no mínimo 1). */
export function sugerirCobertura(pessoas: number, nTurnos: number, diasPorSemana: number): number[] {
  if (pessoas <= 0 || nTurnos <= 0 || diasPorSemana <= 0) return Array(7).fill(0);
  return Array(7).fill(Math.max(1, Math.floor(((pessoas / nTurnos) * diasPorSemana) / 7)));
}

/** Cor de cada turno na grade (índice do turno → classes). */
export const CORES_TURNO = ['bg-azul-bg text-azul-fg', 'bg-violeta-bg text-violeta-fg', 'bg-verde-bg text-verde-fg', 'bg-ambar-bg text-ambar-fg', 'bg-rosa-bg text-rosa-fg', 'bg-neutro-bg text-neutro-fg'] as const;
export const inicialDoTurno = (nome: string, i: number): string => (nome.trim()[0] ?? String(i + 1)).toUpperCase();

/** Texto do balanço de um setor: quantas pessoas a cobertura exige e a equipe que ele tem. */
export function frasePessoas(b: { posicoesSemana: number; pessoasNecessarias: number; sobra: number }, equipe: number, dias: number): string {
  if (b.posicoesSemana === 0) return 'Informe quantas pessoas cada turno precisa.';
  const base = `A cobertura pede ${b.posicoesSemana} posições por semana: cerca de ${b.pessoasNecessarias} pessoa(s) a ${dias} dias, para ${equipe} na equipe.`;
  return b.sobra < 0 ? `${base} Faltam ~${-b.sobra}.` : b.sobra > 0 ? `${base} Sobram ~${b.sobra}.` : `${base} Fecha na medida.`;
}

/** Dias de funcionamento padrão: segunda a sábado abertos (índice 0 = domingo). */
export const FUNCIONAMENTO_PADRAO = [false, true, true, true, true, true, true];

// ===== Jornada de trabalho: aumentar ou reduzir e ver o efeito =====

/** Jornadas mais comuns para comparar (horas por semana × dias de trabalho). */
export const PRESETS_JORNADA = [
  { horas: 44, dias: 6 }, { horas: 44, dias: 5 }, { horas: 42, dias: 6 }, { horas: 40, dias: 5 }, { horas: 36, dias: 6 }, { horas: 36, dias: 5 }, { horas: 30, dias: 5 },
] as const;

/** Sugestão de dias por semana para uma jornada: até 40h cabe em 5 dias; acima disso, 6. */
export const diasDaJornada = (horas: number): number => (horas <= 40 ? 5 : 6);

/** Horas líquidas por dia de uma jornada (arredondadas a 5 min). */
export const liquidaDiariaMin = (horas: number, dias: number): number => Math.round((horas * 60) / dias / 5) * 5;

/**
 * Ajusta a saída do turno para a jornada: mantém entrada e intervalo e muda o fim até a duração líquida ser a da jornada.
 * Null se o resultado não couber em 24 h ou não fizer sentido.
 */
export function ajustarTurnoAJornada(t: Pick<TurnoBase, 'inicio' | 'fim' | 'intervalo'>, horasSemana: number, dias: number): string | null {
  const ini = minutosDeHora(t.inicio);
  if (ini === null || !(horasSemana > 0) || dias < 1) return null;
  const liq = liquidaDiariaMin(horasSemana, dias);
  const fim = ini + liq + t.intervalo;
  if (liq <= 0 || fim - ini > 1440) return null;
  return horaDeMinutos(fim);
}

/** Turno com a saída ajustada à jornada (só se `segueJornada`); sem jornada ou com resultado inválido, devolve o turno como está. */
export function turnoEfetivo<T extends TurnoBase>(t: T, jornadaHoras: number | null, dias: number): T {
  if (!jornadaHoras || !t.segueJornada) return t;
  const fim = ajustarTurnoAJornada(t, jornadaHoras, dias);
  return fim ? { ...t, fim } : t;
}

export type LinhaJornada = { horas: number; dias: number; liquidaDiariaMin: number; pessoasNecessarias: number; equipe: number; sobra: number; horasEquipeSemana: number };
/**
 * Quantas pessoas cada jornada exige para cobrir as posições pedidas (soma dos setores) e quanto da equipe atual sobra ou falta.
 * `posicoesSemana`: por setor, a soma de pessoas × dia pedida por semana; `equipe`: pessoas de cada setor (mesma ordem).
 */
export function compararJornadas(posicoesSemana: number[], equipe: number[], opcoes: readonly { horas: number; dias: number }[] = PRESETS_JORNADA): LinhaJornada[] {
  const total = equipe.reduce((s, n) => s + n, 0);
  return opcoes.map(({ horas, dias }) => {
    const necessarias = posicoesSemana.reduce((s, p) => s + Math.ceil(p / dias), 0);
    // sobra/falta por setor (uma sobra num setor não cobre a falta de outro), somadas
    const saldo = posicoesSemana.reduce((s, p, i) => s + ((equipe[i] ?? 0) - Math.ceil(p / dias)), 0);
    return { horas, dias, liquidaDiariaMin: liquidaDiariaMin(horas, dias), pessoasNecessarias: necessarias, equipe: total, sobra: saldo, horasEquipeSemana: total * horas };
  });
}

// ===== Fim da escala 6x1 (EC 141/2026) =====

export type FaseJornada = { codigo: string; nome: string; inicio: string | null; fim: string | null; horas: number; dias: number; folgas: number; maxDiariaMin: number };
export type RegraFase = { codigo: string; vigencia: string | null; parametros: Record<string, unknown> | null };
const NOMES_FASE: Record<string, string> = { LEGADO_44H: 'Hoje: 6x1', EC141_F1: 'Fase 1: 5x2 com 42h', EC141_F2: 'Fase 2: 5x2 com 40h' };

/** Fases legais da jornada, em ordem cronológica, a partir das regras cadastradas (nada de datas ou limites fixos na tela). */
export function fasesDaJornada(regras: RegraFase[], parse: (v: string) => { inicio: string | null; fim: string | null }): FaseJornada[] {
  const out: FaseJornada[] = [];
  for (const cod of ['LEGADO_44H', 'EC141_F1', 'EC141_F2']) {
    const r = regras.find((x) => x.codigo === cod);
    if (!r?.parametros || !r.vigencia) continue;
    let v: { inicio: string | null; fim: string | null };
    try { v = parse(r.vigencia); } catch { continue; }
    const p = r.parametros;
    const semanal = Number(p.max_semanal_min);
    if (!(semanal > 0)) continue;
    const folgas = Number(p.folgas_semana) || 1;
    out.push({ codigo: cod, nome: NOMES_FASE[cod] ?? cod, inicio: cod === 'LEGADO_44H' ? null : v.inicio, fim: v.fim, horas: semanal / 60, dias: folgas >= 2 ? 5 : 6, folgas, maxDiariaMin: Number(p.max_diaria_min) || 480 });
  }
  return out;
}

/** Fase em vigor numa data (AAAA-MM-DD). */
export const faseNaData = (fases: FaseJornada[], data: string): FaseJornada | null =>
  fases.find((f) => (f.inicio === null || f.inicio <= data) && (f.fim === null || data < f.fim)) ?? null;

/** Horas líquidas por dia que a fase exige em 5 dias e se passa do limite diário (precisa de acordo de jornada diária estendida). */
export function exigenciaDaFase(f: FaseJornada): { liquidaDiariaMin: number; excedeDiaria: boolean; alternativaHoras: number | null } {
  const liq = liquidaDiariaMin(f.horas, f.dias);
  const excede = liq > f.maxDiariaMin;
  return { liquidaDiariaMin: liq, excedeDiaria: excede, alternativaHoras: excede ? (f.maxDiariaMin * f.dias) / 60 : null };
}
