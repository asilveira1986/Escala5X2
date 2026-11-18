import { hhmm } from '@jc/rules-engine';

export type CelulaDiff = { colaboradorId: string; data: string; tipo: string; inicioMin?: number | null; fimMin?: number | null; intervaloMin?: number | null };
export type Mudanca = { colaboradorId: string; data: string; antes: string | null; depois: string | null };
export type ResultadoDiff = { mudancas: Mudanca[]; pessoas: number; dias: number; entraramEmTrabalho: number; sairamDeTrabalho: number; horarioMudou: number };

const ROTULO_TIPO: Record<string, string> = { folga: 'Folga', dsr: 'DSR', ferias: 'Férias', afastamento: 'Afastamento', feriado: 'Feriado' };

/** Texto de um dia: horário do trabalho (com intervalo, se houver) ou o tipo da ausência. Vários lançamentos no dia viram "a + b". */
export function rotuloDoDia(itens: CelulaDiff[]): string {
  return [...itens]
    .sort((a, b) => (a.inicioMin ?? -1) - (b.inicioMin ?? -1) || a.tipo.localeCompare(b.tipo))
    .map((c) => (c.tipo === 'trabalho' ? `${hhmm(c.inicioMin ?? 0)}–${hhmm(c.fimMin ?? 0)}${c.intervaloMin ? ` (int. ${c.intervaloMin} min)` : ''}` : (ROTULO_TIPO[c.tipo] ?? c.tipo)))
    .join(' + ');
}
const trabalha = (rot: string | null) => rot !== null && /^\d/.test(rot);

/** Diferença dia a dia (por pessoa) entre duas versões da mesma escala; ordenada por data e pessoa. Dia só numa das versões conta como mudança. */
export function diffEscalas(de: CelulaDiff[], para: CelulaDiff[]): ResultadoDiff {
  const agrupar = (l: CelulaDiff[]) => { const m = new Map<string, CelulaDiff[]>(); for (const c of l) { const k = `${c.colaboradorId}|${c.data}`; (m.get(k) ?? m.set(k, []).get(k)!).push(c); } return m; };
  const a = agrupar(de), b = agrupar(para);
  const mudancas: Mudanca[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const antes = a.has(k) ? rotuloDoDia(a.get(k)!) : null, depois = b.has(k) ? rotuloDoDia(b.get(k)!) : null;
    if (antes === depois) continue;
    const [colaboradorId, data] = k.split('|') as [string, string];
    mudancas.push({ colaboradorId, data, antes, depois });
  }
  mudancas.sort((x, y) => x.data.localeCompare(y.data) || x.colaboradorId.localeCompare(y.colaboradorId));
  return {
    mudancas,
    pessoas: new Set(mudancas.map((m) => m.colaboradorId)).size,
    dias: new Set(mudancas.map((m) => m.data)).size,
    entraramEmTrabalho: mudancas.filter((m) => !trabalha(m.antes) && trabalha(m.depois)).length,
    sairamDeTrabalho: mudancas.filter((m) => trabalha(m.antes) && !trabalha(m.depois)).length,
    horarioMudou: mudancas.filter((m) => trabalha(m.antes) && trabalha(m.depois)).length,
  };
}
