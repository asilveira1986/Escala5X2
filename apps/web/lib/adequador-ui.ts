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
