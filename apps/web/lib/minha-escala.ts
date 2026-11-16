import { dataDoNumero, diaDaSemana, hhmm, numeroDoDia, type DataISO } from '@jc/rules-engine';

export type LinhaMinhaEscala = {
  escala_id: string; data: DataISO; tipo: 'trabalho' | 'folga' | 'dsr' | 'ferias' | 'afastamento' | 'feriado';
  inicio_min: number | null; fim_min: number | null; intervalo_min: number;
  escala: { id: string; nome: string; periodo: string; versao: number; publicada_em: string | null; hash_publicado: string | null };
};

export type DiaMinhaEscala = { data: DataISO; tipo: LinhaMinhaEscala['tipo']; inicioMin: number | null; fimMin: number | null; intervaloMin: number };
export type EscalaPublicada = {
  id: string; nome: string; versao: number; publicadaEm: string | null; inicio: DataISO; fim: DataISO; hash: string | null;
  dias: DiaMinhaEscala[]; cienteEm: string | null;
};

/** "[2027-02-01,2027-03-01)" → { inicio, fim } com fim inclusivo. */
export function lerPeriodo(p: string): { inicio: DataISO; fim: DataISO } {
  const m = /^[\[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})[\])]$/.exec(p);
  if (!m) throw new Error(`período inválido: ${p}`);
  return { inicio: m[1]!, fim: dataDoNumero(numeroDoDia(m[2]!) - 1) };
}

export function agruparPorEscala(linhas: LinhaMinhaEscala[], ciencias: Array<{ escala_id: string; ciente_em: string }>): EscalaPublicada[] {
  const cienteEm = new Map(ciencias.map((c) => [c.escala_id, c.ciente_em]));
  const por = new Map<string, EscalaPublicada>();
  for (const l of linhas) {
    let e = por.get(l.escala_id);
    if (!e) {
      const { inicio, fim } = lerPeriodo(l.escala.periodo);
      e = { id: l.escala.id, nome: l.escala.nome, versao: l.escala.versao, publicadaEm: l.escala.publicada_em, inicio, fim, hash: l.escala.hash_publicado, dias: [], cienteEm: cienteEm.get(l.escala_id) ?? null };
      por.set(l.escala_id, e);
    }
    e.dias.push({ data: l.data, tipo: l.tipo, inicioMin: l.inicio_min, fimMin: l.fim_min, intervaloMin: l.intervalo_min });
  }
  for (const e of por.values()) e.dias.sort((a, b) => a.data.localeCompare(b.data) || (a.inicioMin ?? 0) - (b.inicioMin ?? 0));
  // mais recente primeiro; dentro do mesmo período, a maior versão
  return [...por.values()].sort((a, b) => b.inicio.localeCompare(a.inicio) || b.versao - a.versao);
}

export const horasLiquidasMin = (d: Pick<DiaMinhaEscala, 'tipo' | 'inicioMin' | 'fimMin' | 'intervaloMin'>): number =>
  d.tipo === 'trabalho' && d.inicioMin != null && d.fimMin != null ? Math.max(0, d.fimMin - d.inicioMin - d.intervaloMin) : 0;

/** Próximo turno a partir de agora (hoje conta se ainda não terminou). `agoraMin` = minutos desde 00:00 de hoje. */
export function proximoTurno(escalas: EscalaPublicada[], hoje: DataISO, agoraMin: number): { escalaId: string; dia: DiaMinhaEscala } | null {
  let melhor: { escalaId: string; dia: DiaMinhaEscala; chave: number } | null = null;
  for (const e of escalas) {
    for (const d of e.dias) {
      if (d.tipo !== 'trabalho' || d.inicioMin == null || d.fimMin == null) continue;
      const delta = numeroDoDia(d.data) - numeroDoDia(hoje);
      const fimAbs = delta * 1440 + d.fimMin;
      if (fimAbs <= agoraMin) continue; // já terminou
      const chave = delta * 1440 + d.inicioMin;
      if (!melhor || chave < melhor.chave) melhor = { escalaId: e.id, dia: d, chave };
    }
  }
  return melhor ? { escalaId: melhor.escalaId, dia: melhor.dia } : null;
}

/** Semanas (começando no domingo) cobrindo o período; `null` = dia fora do período. */
export function semanasDoPeriodo(inicio: DataISO, fim: DataISO): Array<Array<DataISO | null>> {
  const a = numeroDoDia(inicio), b = numeroDoDia(fim);
  const dias: Array<DataISO | null> = Array.from({ length: diaDaSemana(inicio) }, () => null);
  for (let n = a; n <= b; n++) dias.push(dataDoNumero(n));
  while (dias.length % 7 !== 0) dias.push(null);
  return Array.from({ length: dias.length / 7 }, (_, i) => dias.slice(i * 7, i * 7 + 7));
}

export const textoTurno = (d: Pick<DiaMinhaEscala, 'tipo' | 'inicioMin' | 'fimMin' | 'intervaloMin'>): string => {
  switch (d.tipo) {
    case 'trabalho': return `${hhmm(d.inicioMin ?? 0)} às ${hhmm(d.fimMin ?? 0)}${(d.fimMin ?? 0) > 1440 ? ' (dia seguinte)' : ''}${d.intervaloMin ? ` · intervalo de ${d.intervaloMin} min` : ''}`;
    case 'folga': return 'Folga';
    case 'dsr': return 'Descanso semanal';
    case 'ferias': return 'Férias';
    case 'afastamento': return 'Afastamento';
    case 'feriado': return 'Feriado';
  }
};
