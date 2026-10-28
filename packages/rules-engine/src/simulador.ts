import type { AgregadoGrupo, Diagnostico } from './diagnostico';

export type TipoCenario = 'contratar' | 'horas_extras' | 'reorganizar_turnos' | 'acordo_compensatorio';

export type ParametrosCenario = {
  tipo: TipoCenario;
  nome?: string;
  fase: 'F1' | 'F2';
  /** Encargos sobre folha e horas extras, em % (ex.: 35 = 35%). Sem padrão legal: informado pelo usuário. */
  encargosPct: number;
  /** Adicional de hora extra em % (mínimo legal 50, ou o do acordo). */
  adicionalHePct: number;
  /** Custo único por contratação (recrutamento, treinamento), em centavos. */
  custoContratacaoUnicoCentavos: number;
  /** reorganizar_turnos: % do déficit absorvido sem custo; o restante vai para hora extra. */
  absorcaoPct: number;
  /** acordo_compensatorio: custo adicional sobre a folha dos afetados, em %. */
  custoAdicionalFolhaPct: number;
  /** Multiplicador salarial do cenário; < 1 é redução e é bloqueado. */
  fatorSalario: number;
};

export const PARAMETROS_PADRAO: Omit<ParametrosCenario, 'tipo'> = {
  fase: 'F2',
  encargosPct: 0,
  adicionalHePct: 50,
  custoContratacaoUnicoCentavos: 0,
  absorcaoPct: 0,
  custoAdicionalFolhaPct: 0,
  fatorSalario: 1,
};

export type ResultadoCenario = {
  nome: string;
  tipo: TipoCenario;
  fase: 'F1' | 'F2';
  bloqueado: boolean;
  custoMensalCentavos: number;
  custoUnicoCentavos: number;
  custoAnualCentavos: number;
  contratacoes: number;
  horasCobertasMensaisMin: number;
  /** Parcela do custo causada pelo aumento do valor da hora sobre horas extras já praticadas. */
  impactoValorHoraHeCentavos: number;
  alertas: string[];
};

const SEMANAS_POR_MES = 52 / 12;

/** Falha se o salário novo for menor que o atual. */
export class ErroReducaoSalarial extends Error {
  constructor() {
    super('Cenário implica redução salarial: bloqueado.');
    this.name = 'ErroReducaoSalarial';
  }
}
export function garantirSemReducao(atualCentavos: number, novoCentavos: number): void {
  if (novoCentavos < atualCentavos) throw new ErroReducaoSalarial();
}

function valorHoraGrupo(g: AgregadoGrupo, fase: 'F1' | 'F2') {
  return fase === 'F1' ? g.valorHoraMedioF1Centavos : g.valorHoraMedioF2Centavos;
}

export function simular(diag: Diagnostico, p: ParametrosCenario): ResultadoCenario {
  const nome = p.nome ?? p.tipo;
  const vazio: ResultadoCenario = {
    nome, tipo: p.tipo, fase: p.fase, bloqueado: false, custoMensalCentavos: 0, custoUnicoCentavos: 0, custoAnualCentavos: 0,
    contratacoes: 0, horasCobertasMensaisMin: 0, impactoValorHoraHeCentavos: 0, alertas: [],
  };
  try {
    garantirSemReducao(100, Math.round(100 * p.fatorSalario));
  } catch {
    return { ...vazio, bloqueado: true, alertas: ['Cenário implica redução salarial (irredutibilidade de salário): bloqueado.'] };
  }
  for (const [k, v] of Object.entries({ encargosPct: p.encargosPct, adicionalHePct: p.adicionalHePct, absorcaoPct: p.absorcaoPct, custoAdicionalFolhaPct: p.custoAdicionalFolhaPct })) {
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`Parâmetro inválido: ${k}`);
  }
  if (p.absorcaoPct > 100) throw new RangeError('absorcaoPct acima de 100');

  const enc = 1 + p.encargosPct / 100;
  const he = 1 + p.adicionalHePct / 100;
  const alertas: string[] = [];
  const deficit = (g: AgregadoGrupo) => (p.fase === 'F1' ? g.horasPerdidasF1Min : g.horasPerdidasF2Min);
  const fte = (g: AgregadoGrupo) => (p.fase === 'F1' ? g.fteF1 : g.fteF2);

  // Aumento do valor da hora encarece as horas extras já praticadas.
  let impacto = 0;
  for (const i of diag.itens) {
    const est = p.fase === 'F1' ? (i.f1 ?? i.f2) : i.f2;
    impacto += (i.horasExtrasMensaisMin / 60) * (est.valorHoraCentavos - i.valorHoraAtualCentavos) * he * enc;
  }

  let mensal = 0, unico = 0, contrat = 0, cobertas = 0;
  for (const g of diag.grupos) {
    const d = deficit(g);
    if (d <= 0) continue;
    const horasMes = d * SEMANAS_POR_MES;
    if (p.tipo === 'contratar') {
      const n = Math.ceil(fte(g) - 1e-9);
      contrat += n;
      mensal += n * g.salarioMedioCentavos * enc;
      unico += n * p.custoContratacaoUnicoCentavos;
      cobertas += horasMes;
    } else if (p.tipo === 'horas_extras') {
      mensal += (horasMes / 60) * valorHoraGrupo(g, p.fase) * he * enc;
      cobertas += horasMes;
    } else if (p.tipo === 'reorganizar_turnos') {
      const resto = horasMes * (1 - p.absorcaoPct / 100);
      mensal += (resto / 60) * valorHoraGrupo(g, p.fase) * he * enc;
      cobertas += horasMes;
    } else {
      cobertas += horasMes;
    }
  }
  if (p.tipo === 'acordo_compensatorio') {
    const folhaAfetada = diag.itens
      .filter((i) => (p.fase === 'F1' ? (i.f1 ?? i.f2) : i.f2).horasPerdidasMin > 0)
      .reduce((a, i) => a + i.salarioCentavos, 0);
    mensal += folhaAfetada * (p.custoAdicionalFolhaPct / 100) * enc;
    alertas.push('Exige acordo ou convenção coletiva cadastrada e revisão de advogado; minuta não substitui parecer jurídico.');
  }
  if (p.tipo === 'reorganizar_turnos' && p.absorcaoPct > 0) {
    alertas.push('A absorção por reorganização de turnos depende da cobertura mínima por faixa; valide no editor de escalas.');
  }
  if (p.tipo === 'horas_extras') {
    alertas.push('Verifique o limite de 2 horas extras por dia e o intervalo de 11h entre jornadas ao distribuir as horas.');
  }

  mensal += impacto;
  const m = Math.round(mensal);
  return {
    ...vazio, bloqueado: false, alertas,
    custoMensalCentavos: m,
    custoUnicoCentavos: Math.round(unico),
    custoAnualCentavos: m * 12 + Math.round(unico),
    contratacoes: contrat,
    horasCobertasMensaisMin: Math.round(cobertas),
    impactoValorHoraHeCentavos: Math.round(impacto),
  };
}
