import { numeroDoDia, PARAMETROS_PADRAO, simular, type Diagnostico, type ParametrosCenario, type ResultadoCenario } from '@jc/rules-engine';

export type Fase = 'F1' | 'F2';
export type SetorProntidao = { setor: string; pessoas: number; afetadosF1: number; afetadosF2: number; horasPerdidasF2Min: number; fteF1: number; fteF2: number; prontoF1: boolean; prontoF2: boolean };
export type Prontidao = {
  total: number;
  prontosF1: number; prontosF2: number; pctF1: number; pctF2: number;
  /** Dias até o início de cada fase (negativo = já em vigor). */
  diasF1: number; diasF2: number; f1Inicio: string; f2Inicio: string;
  setores: SetorProntidao[];
};

const pct = (n: number, total: number) => (total === 0 ? 100 : Math.round((n / total) * 100));
export const SEM_SETOR = 'Sem setor';

/** Resumo de quão preparada a empresa está para cada fase, calculado do diagnóstico (nada é gravado). */
export function resumirProntidao(d: Diagnostico, hoje: string): Prontidao {
  const total = d.itens.length;
  const prontosF1 = d.itens.filter((i) => (i.f1 ? i.f1.conforme : i.f2.conforme)).length;
  const prontosF2 = d.itens.filter((i) => i.f2.conforme).length;
  const porSetor = new Map<string, SetorProntidao>();
  for (const g of d.grupos) {
    const k = g.setor ?? SEM_SETOR;
    const s = porSetor.get(k) ?? { setor: k, pessoas: 0, afetadosF1: 0, afetadosF2: 0, horasPerdidasF2Min: 0, fteF1: 0, fteF2: 0, prontoF1: true, prontoF2: true };
    s.pessoas += g.colaboradores; s.afetadosF1 += g.afetadosF1; s.afetadosF2 += g.afetadosF2; s.horasPerdidasF2Min += g.horasPerdidasF2Min;
    s.fteF1 += g.fteF1; s.fteF2 += g.fteF2;
    porSetor.set(k, s);
  }
  const setores = [...porSetor.values()].map((s) => ({ ...s, fteF1: Math.round(s.fteF1 * 100) / 100, fteF2: Math.round(s.fteF2 * 100) / 100, prontoF1: s.afetadosF1 === 0, prontoF2: s.afetadosF2 === 0 }))
    .sort((a, b) => b.afetadosF2 - a.afetadosF2 || b.horasPerdidasF2Min - a.horasPerdidasF2Min || a.setor.localeCompare(b.setor, 'pt-BR'));
  return {
    total, prontosF1, prontosF2, pctF1: pct(prontosF1, total), pctF2: pct(prontosF2, total),
    diasF1: numeroDoDia(d.fases.f1Inicio) - numeroDoDia(hoje), diasF2: numeroDoDia(d.fases.f2Inicio) - numeroDoDia(hoje),
    f1Inicio: d.fases.f1Inicio, f2Inicio: d.fases.f2Inicio,
    setores,
  };
}

export type PremissasCusto = { encargosPct: number; adicionalHePct: number; custoContratacaoCentavos: number };
export type LinhaCusto = { fase: Fase; tipo: 'horas_extras' | 'contratar'; resultado: ResultadoCenario; maisBarato: boolean };

/** Compara, para cada fase, cobrir as horas com horas extras ou com contratação, e marca a de menor custo anual. */
export function compararCustos(d: Diagnostico, p: PremissasCusto): LinhaCusto[] {
  const fases: Fase[] = d.itens.some((i) => i.f1) ? ['F1', 'F2'] : ['F2'];
  const out: LinhaCusto[] = [];
  for (const fase of fases) {
    const base: Omit<ParametrosCenario, 'tipo'> = { ...PARAMETROS_PADRAO, fase, encargosPct: p.encargosPct, adicionalHePct: p.adicionalHePct, custoContratacaoUnicoCentavos: p.custoContratacaoCentavos };
    const linhas = (['horas_extras', 'contratar'] as const).map((tipo) => ({ fase, tipo, resultado: simular(d, { ...base, tipo }), maisBarato: false }));
    const menor = Math.min(...linhas.map((l) => l.resultado.custoAnualCentavos));
    for (const l of linhas) l.maisBarato = menor > 0 && l.resultado.custoAnualCentavos === menor && linhas.some((x) => x.resultado.custoAnualCentavos > menor);
    out.push(...linhas);
  }
  return out;
}
