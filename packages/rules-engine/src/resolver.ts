import { somarDias, validarData, vigenciaContem, type DataISO } from './datas';
import { ErroRegras, type AcordoDoColaborador, type ContextoColaborador, type Regra, type RegrasEfetivas } from './tipos';

const CHAVES_ESPECIAIS = new Set(['alta_renda', 'acordo']);
const PARAMETROS_OBRIGATORIOS = ['max_semanal_min', 'max_diaria_min', 'folgas_semana', 'divisor', 'interjornada_min', 'max_he_dia_min', 'he_percentual_min'] as const;

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [v];
}

/** O escopo restringe a regra; chaves desconhecidas desligam a regra (falha segura). */
export function escopoCombina(escopo: Record<string, unknown>, ctx: ContextoColaborador): boolean {
  for (const [chave, valor] of Object.entries(escopo)) {
    if (CHAVES_ESPECIAIS.has(chave)) continue;
    switch (chave) {
      case 'porte': if (!lista(valor).includes(ctx.empresa.porte)) return false; break;
      case 'terceirizada_publica': if (valor !== ctx.empresa.terceirizadaPublica) return false; break;
      case 'uf': if (!lista(valor).includes(ctx.empresa.uf)) return false; break;
      case 'municipio_ibge': if (!lista(valor).includes(ctx.empresa.municipioIbge)) return false; break;
      default: return false;
    }
  }
  return true;
}

function num(p: Record<string, unknown>, chave: string): number | undefined {
  const v = p[chave];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function acordoVale(a: AcordoDoColaborador, data: DataISO): boolean {
  return a.status === 'vigente' && vigenciaContem(a.vigencia, data);
}

/**
 * Resolve as regras de um colaborador numa data.
 * 1) regras gerais ativas e vigentes; 2) filtro por escopo; 3) exceções (alta renda, acordos);
 * 4) mescla por prioridade (a mais específica vence); 5) registra as regras aplicadas.
 */
export function resolverRegras(ctx: ContextoColaborador, data: DataISO, regras: Regra[]): RegrasEfetivas {
  validarData(data);
  const vigentes = regras.filter((r) => r.ativa && vigenciaContem(r.vigencia, data));
  const gerais = vigentes
    .filter((r) => !('alta_renda' in r.escopo) && !('acordo' in r.escopo) && escopoCombina(r.escopo, ctx))
    .sort((a, b) => a.prioridade - b.prioridade || a.codigo.localeCompare(b.codigo));
  if (gerais.length === 0) throw new ErroRegras(`Nenhuma regra geral vigente em ${data}`);

  const base: Record<string, unknown> = {};
  const aplicadas: string[] = [];
  for (const r of gerais) {
    Object.assign(base, r.parametros);
    aplicadas.push(r.codigo);
  }
  for (const chave of PARAMETROS_OBRIGATORIOS) {
    if (num(base, chave) === undefined) throw new ErroRegras(`Parâmetro "${chave}" ausente nas regras vigentes em ${data}`);
  }

  const e: RegrasEfetivas = {
    maxSemanalMin: num(base, 'max_semanal_min')!,
    maxDiariaMin: num(base, 'max_diaria_min')!,
    folgasPorSemana: num(base, 'folgas_semana')!,
    divisor: num(base, 'divisor')!,
    interjornadaMin: num(base, 'interjornada_min')!,
    maxHoraExtraDiaMin: num(base, 'max_he_dia_min')!,
    adicionalHePercentual: num(base, 'he_percentual_min')!,
    tetoGeralSemanalMin: num(base, 'max_semanal_min')!,
    regrasAplicadas: aplicadas,
  };

  // Exceção: alta renda — jornada diferenciada, mantida a 5x2.
  for (const r of vigentes.filter((x) => x.escopo.alta_renda === true && escopoCombina(x.escopo, ctx)).sort((a, b) => a.prioridade - b.prioridade)) {
    const piso = num(r.parametros, 'salario_minimo');
    if (piso === undefined) continue;
    const superior = ctx.escolaridade === 'superior' || ctx.escolaridade === 'pos';
    if ((r.parametros.exige_superior !== false && !superior) || ctx.salarioBaseCentavos < Math.round(piso * 100)) continue;
    if (r.parametros.jornada_diferenciada === true) {
      e.maxSemanalMin = Math.max(e.maxSemanalMin, ctx.jornadaSemanalMin);
      e.divisor = Math.max(e.divisor, Math.round((e.maxSemanalMin * 5) / 60));
    }
    const folgas = num(r.parametros, 'folgas_semana');
    if (folgas !== undefined) e.folgasPorSemana = Math.max(e.folgasPorSemana, folgas);
    e.regrasAplicadas.push(r.codigo);
  }

  // Exceções por acordo/convenção: só valem com status "vigente", dentro da vigência e com a regra ativa.
  const ruleAcordo = (tipo: string) => vigentes.find((r) => r.escopo.acordo === tipo);
  for (const ac of ctx.acordos.filter((a) => acordoVale(a, data))) {
    for (const cl of ac.clausulas) {
      const p = cl.parametros;
      if (cl.tipo === 'regime_compensatorio') {
        const regra = ruleAcordo('regime_compensatorio');
        const escala = typeof p.escala === 'string' ? p.escala : undefined;
        if (!regra || !escala) continue;
        e.regimeCompensatorio = { escala, maxDiariaMin: num(p, 'max_diaria_min') ?? e.maxDiariaMin };
        const sem = num(p, 'max_semanal_min');
        if (sem !== undefined) e.maxSemanalMin = sem;
        const fol = num(p, 'folgas_semana');
        if (fol !== undefined) e.folgasPorSemana = fol;
        if (!e.regrasAplicadas.includes(regra.codigo)) e.regrasAplicadas.push(regra.codigo);
      } else if (cl.tipo === 'jornada_diaria_estendida') {
        const regra = ruleAcordo('jornada_diaria_estendida');
        const dia = num(p, 'max_diaria_min');
        if (!regra || dia === undefined) continue;
        e.maxDiariaMin = Math.max(e.maxDiariaMin, dia); // o teto semanal da fase continua valendo
        if (!e.regrasAplicadas.includes(regra.codigo)) e.regrasAplicadas.push(regra.codigo);
      } else if (cl.tipo === 'rodizio_domingo') {
        const n = num(p, 'a_cada_n_semanas');
        if (n !== undefined && n >= 1) e.domingoRodizio = { aCadaNSemanas: n };
      } else if (cl.tipo === 'adicional_he') {
        const pct = num(p, 'percentual');
        if (pct !== undefined) e.adicionalHePercentual = Math.max(e.adicionalHePercentual, pct);
      } else if (cl.tipo === 'banco_horas') {
        e.bancoHoras = p;
      }
    }
  }
  return e;
}

/** Divisor efetivo: o da regra, ou o do contrato quando menor (nunca aumenta o divisor). */
export function divisorEfetivo(regras: RegrasEfetivas, ctx: ContextoColaborador): number {
  return Math.min(regras.divisor, ctx.divisorContrato);
}

/** Valor da hora em centavos (fracionário; arredonde só ao exibir ou somar). */
export function valorHoraCentavos(salarioCentavos: number, divisor: number): number {
  if (divisor <= 0) throw new ErroRegras('Divisor inválido');
  return salarioCentavos / divisor;
}

export const diaAnterior = (d: DataISO): DataISO => somarDias(d, -1);
