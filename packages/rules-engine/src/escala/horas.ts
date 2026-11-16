import type { DataISO } from '../datas';
import type { Alocacao, Feriado } from './tipos';
import { dataDoNumero, diaDaSemana, HORA_NOTURNA_MIN, inicioDaSemana, minutosNoturnos, numeroDoDia, turnoDe } from './tempo';

export type Limite = number | ((data: DataISO) => number);

export type ParametrosHoras = {
  maxDiariaMin: Limite;
  maxSemanalMin: Limite;
  /** 0 = domingo, 1 = segunda (padrão). */
  inicioSemana?: 0 | 1;
  /** Período do fechamento; sem ele, usa do primeiro ao último dia com lançamento. */
  periodo?: { inicio: DataISO; fim: DataISO };
};

export type HorasDoDia = {
  data: DataISO;
  trabalhadasMin: number;
  /** Excesso sobre o limite diário. */
  extrasDiariasMin: number;
  noturnasRelogioMin: number;
  /** Minutos noturnos convertidos pela hora reduzida de 52min30s (o que se paga). */
  noturnasComputadasMin: number;
};

export type ResumoHoras = {
  trabalhadasMin: number;
  normaisMin: number;
  extrasMin: number;
  noturnasRelogioMin: number;
  noturnasComputadasMin: number;
  domingoMin: number;
  feriadoMin: number;
  diasTrabalhados: number;
  domingosTrabalhados: number;
  domingosFolgados: number;
  feriadosTrabalhados: number;
  feriadosFolgados: number;
  porDia: HorasDoDia[];
};

const valor = (l: Limite, d: DataISO): number => (typeof l === 'number' ? l : l(d));

/**
 * Horas de UM colaborador para folha e banco de horas. Trabalha em minutos inteiros.
 * - Horas trabalhadas = duração do turno menos o intervalo.
 * - Extras = excesso diário sobre o limite do dia + excesso semanal sobre as horas normais da semana
 *   (as horas já contadas como extras diárias não entram duas vezes).
 * - Noturnas: 22h às 5h, convertidas pela hora reduzida (52min30s). O intervalo é descontado primeiro da parte diurna.
 * - A semana incompleta nas pontas do período só tem as horas lançadas; passe o período inteiro para o fechamento.
 */
export function calcularHoras(alocacoes: Alocacao[], feriados: Feriado[], p: ParametrosHoras): ResumoHoras {
  const inicioSemana = p.inicioSemana ?? 1;
  const feriadoSet = new Set(feriados.map((f) => f.data));
  const dias = new Map<DataISO, HorasDoDia>();
  const dia = (data: DataISO): HorasDoDia => {
    let d = dias.get(data);
    if (!d) dias.set(data, (d = { data, trabalhadasMin: 0, extrasDiariasMin: 0, noturnasRelogioMin: 0, noturnasComputadasMin: 0 }));
    return d;
  };

  let domingoMin = 0;
  let feriadoMin = 0;
  const diasComTrabalho = new Set<DataISO>();
  for (const a of alocacoes) {
    const t = turnoDe(a);
    if (!t) continue;
    const d = dia(a.data);
    d.trabalhadasMin += t.liquidoMin;
    diasComTrabalho.add(a.data);
    const noturnoBruto = minutosNoturnos(t.ini, t.fim);
    const diurnoBruto = t.brutoMin - noturnoBruto;
    const noturno = Math.max(0, noturnoBruto - Math.max(0, t.intervaloMin - diurnoBruto));
    d.noturnasRelogioMin += noturno;
    d.noturnasComputadasMin += Math.round((noturno * 60) / HORA_NOTURNA_MIN);
    if (diaDaSemana(a.data) === 0) domingoMin += t.liquidoMin;
    if (feriadoSet.has(a.data)) feriadoMin += t.liquidoMin;
  }

  let normaisDiarias = 0;
  let extrasDiarias = 0;
  const normaisPorSemana = new Map<DataISO, { normais: number; ultimoDia: DataISO }>();
  for (const d of dias.values()) {
    d.extrasDiariasMin = Math.max(0, d.trabalhadasMin - valor(p.maxDiariaMin, d.data));
    extrasDiarias += d.extrasDiariasMin;
    const normais = d.trabalhadasMin - d.extrasDiariasMin;
    normaisDiarias += normais;
    const w = inicioDaSemana(d.data, inicioSemana);
    const atual = normaisPorSemana.get(w) ?? { normais: 0, ultimoDia: d.data };
    atual.normais += normais;
    if (d.data > atual.ultimoDia) atual.ultimoDia = d.data;
    normaisPorSemana.set(w, atual);
  }
  let extrasSemanais = 0;
  for (const s of normaisPorSemana.values()) extrasSemanais += Math.max(0, s.normais - valor(p.maxSemanalMin, s.ultimoDia));

  const todos = [...dias.keys(), ...alocacoes.map((a) => a.data)].sort();
  const ini = p.periodo?.inicio ?? todos[0];
  const fim = p.periodo?.fim ?? todos[todos.length - 1];
  let domingosTrab = 0, domingosFolg = 0, feriadosTrab = 0, feriadosFolg = 0;
  if (ini && fim) {
    for (let n = numeroDoDia(ini); n <= numeroDoDia(fim); n++) {
      const data = dataDoNumero(n);
      if (diaDaSemana(data) === 0) diasComTrabalho.has(data) ? domingosTrab++ : domingosFolg++;
      if (feriadoSet.has(data)) diasComTrabalho.has(data) ? feriadosTrab++ : feriadosFolg++;
    }
  }

  const porDia = [...dias.values()].sort((a, b) => a.data.localeCompare(b.data));
  const soma = (f: (d: HorasDoDia) => number) => porDia.reduce((acc, d) => acc + f(d), 0);
  const extrasMin = extrasDiarias + extrasSemanais;
  return {
    trabalhadasMin: soma((d) => d.trabalhadasMin),
    normaisMin: normaisDiarias - extrasSemanais,
    extrasMin,
    noturnasRelogioMin: soma((d) => d.noturnasRelogioMin),
    noturnasComputadasMin: soma((d) => d.noturnasComputadasMin),
    domingoMin, feriadoMin,
    diasTrabalhados: diasComTrabalho.size,
    domingosTrabalhados: domingosTrab, domingosFolgados: domingosFolg,
    feriadosTrabalhados: feriadosTrab, feriadosFolgados: feriadosFolg,
    porDia,
  };
}
