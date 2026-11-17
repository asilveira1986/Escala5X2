/** Auxiliares puros da tela do Adequador de escala (horários, carga semanal, sugestão de cobertura). */
export type TurnoBase = { chave: string; nome: string; inicio: string; fim: string; intervalo: number; modeloId: string | null };
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
