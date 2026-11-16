import { dataDoNumero, numeroDoDia, type DataISO } from '@jc/rules-engine';
import type { EntradaEscala } from './escala-entrada';

/** Marcação já vinculada a um colaborador (de `marcacao_ponto`). */
export type MarcacaoPonto = { colaborador_id: string; momento: string };

export type CodigoConciliacao = 'SEM_MARCACAO' | 'MARCACAO_IMPAR' | 'ATRASO' | 'SAIDA_ANTECIPADA' | 'HORA_EXTRA_REALIZADA' | 'INTERVALO_REDUZIDO' | 'MARCACAO_EM_FOLGA' | 'MARCACAO_EM_AUSENCIA';
export type DiaConciliado = {
  colaboradorId: string; data: DataISO;
  previstoLiquidoMin: number;                    // o que a escala previa (0 em dia de folga)
  apuradoMin: number | null;                     // soma dos pares entrada→saída (null se não dá para apurar)
  marcacoes: string[];                           // horas locais HH:MM, em ordem
  atrasoMin: number; saidaAntecipadaMin: number; horaExtraMin: number; intervaloRealizadoMin: number | null;
  codigos: CodigoConciliacao[];
};
export type ResumoColaboradorConciliacao = { colaboradorId: string; nome: string; diasPrevistos: number; diasSemMarcacao: number; previstoMin: number; apuradoMin: number; atrasoMin: number; horaExtraMin: number; diasComDivergencia: number };
export type Conciliacao = { dias: DiaConciliado[]; resumo: ResumoColaboradorConciliacao[] };
export type OpcoesConciliacao = {
  /** Tolerância por marcação (CLT art. 58 §1º: variações de até 5 min não contam, limitadas a 10 min por dia). */
  toleranciaMin?: number; toleranciaDiariaMin?: number;
  /** Quanto antes do início e depois do fim do turno uma marcação ainda é do turno. */
  janelaMin?: number;
};

const MIN = 60_000;
const hh = (ms: number) => { const d = new Date(ms - 3 * 3600_000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
/** Instante (ms UTC) do dia civil de São Paulo + minutos desde 00:00 (UTC-3 fixo: o horário de verão acabou em 2019). */
const instante = (data: DataISO, min: number) => numeroDoDia(data) * 86_400_000 + min * MIN + 3 * 3600_000;
const dataLocal = (ms: number): DataISO => dataDoNumero(Math.floor((ms - 3 * 3600_000) / 86_400_000));

/**
 * Compara a escala publicada com as marcações do relógio. Só informa: não muda escala, banco de horas nem folha.
 * Marcações são casadas com o turno do dia (janela em volta dele, inclusive turno que vira a noite); as que não
 * pertencem a nenhum turno viram "marcação em folga". Os pares entrada→saída em ordem dão as horas apuradas.
 */
export function conciliarPonto(entrada: EntradaEscala, marcacoes: MarcacaoPonto[], opcoes: OpcoesConciliacao = {}): Conciliacao {
  const tol = opcoes.toleranciaMin ?? 5, tolDia = opcoes.toleranciaDiariaMin ?? 10, janela = (opcoes.janelaMin ?? 240) * MIN;
  const { inicio, fim } = entrada.escala;
  const nomes = new Map(entrada.colaboradores.map((c) => [c.colaboradorId, c.nome]));
  const porColab = new Map<string, number[]>();
  for (const m of marcacoes) (porColab.get(m.colaborador_id) ?? porColab.set(m.colaborador_id, []).get(m.colaborador_id)!).push(Date.parse(m.momento));
  for (const l of porColab.values()) l.sort((a, b) => a - b);

  const ausente = (c: string, d: DataISO) => entrada.ausencias.some((a) => a.colaboradorId === c && d >= a.inicio && d <= a.fim);
  const dias: DiaConciliado[] = [];

  for (const [colab] of nomes) {
    const turnos = entrada.alocacoes.filter((a) => a.colaboradorId === colab && a.tipo === 'trabalho' && a.inicioMin != null && a.fimMin != null && a.data >= inicio && a.data <= fim)
      .map((a) => ({ data: a.data, ini: instante(a.data, a.inicioMin!), fim: instante(a.data, a.fimMin!), intervalo: a.intervaloMin ?? 0, liquido: a.fimMin! - a.inicioMin! - (a.intervaloMin ?? 0) }))
      .sort((a, b) => a.ini - b.ini);
    const todas = porColab.get(colab) ?? [];
    const usadas = new Set<number>();

    for (const t of turnos) {
      const meus = todas.filter((ms, i) => !usadas.has(i) && ms >= t.ini - janela && ms <= t.fim + janela);
      todas.forEach((ms, i) => { if (ms >= t.ini - janela && ms <= t.fim + janela) usadas.add(i); });
      const codigos: CodigoConciliacao[] = [];
      let apurado: number | null = 0, atraso = 0, antecipada = 0, extra = 0, intervaloReal: number | null = null;
      if (meus.length === 0) { codigos.push('SEM_MARCACAO'); apurado = null; }
      else if (meus.length % 2 === 1) { codigos.push('MARCACAO_IMPAR'); apurado = null; }
      else {
        for (let i = 0; i < meus.length; i += 2) apurado += Math.round((meus[i + 1]! - meus[i]!) / MIN);
        if (meus.length >= 4) intervaloReal = Math.round((meus[2]! - meus[1]!) / MIN);
        const dEntrada = Math.round((meus[0]! - t.ini) / MIN), dSaida = Math.round((meus[meus.length - 1]! - t.fim) / MIN);
        // tolerância: variação de até `tol` min em cada ponta não conta, e o total do dia só deixa de contar se couber em `tolDia`
        const dentro = Math.abs(dEntrada) <= tol && Math.abs(dSaida) <= tol && Math.abs(dEntrada) + Math.abs(dSaida) <= tolDia;
        if (!dentro) {
          if (dEntrada > tol) { atraso = dEntrada; codigos.push('ATRASO'); }
          if (dSaida < -tol) { antecipada = -dSaida; codigos.push('SAIDA_ANTECIPADA'); }
          if (dSaida > tol) { extra = dSaida; codigos.push('HORA_EXTRA_REALIZADA'); }
          if (dEntrada < -tol) extra += -dEntrada;               // chegou bem antes e registrou: também é tempo à disposição
          if (dEntrada < -tol && !codigos.includes('HORA_EXTRA_REALIZADA')) codigos.push('HORA_EXTRA_REALIZADA');
        }
        if (intervaloReal !== null && t.intervalo > 0 && intervaloReal < t.intervalo - tol) codigos.push('INTERVALO_REDUZIDO');
      }
      dias.push({ colaboradorId: colab, data: t.data, previstoLiquidoMin: t.liquido, apuradoMin: apurado, marcacoes: meus.map(hh), atrasoMin: atraso, saidaAntecipadaMin: antecipada, horaExtraMin: extra, intervaloRealizadoMin: intervaloReal, codigos });
    }

    // marcações que não pertencem a nenhum turno: dia de folga ou de ausência
    const soltas = new Map<DataISO, number[]>();
    todas.forEach((ms, i) => { if (!usadas.has(i)) { const d = dataLocal(ms); if (d >= inicio && d <= fim) soltas.set(d, [...(soltas.get(d) ?? []), ms]); } });
    for (const [d, l] of [...soltas].sort(([a], [b]) => a.localeCompare(b))) {
      dias.push({ colaboradorId: colab, data: d, previstoLiquidoMin: 0, apuradoMin: l.length % 2 === 0 ? l.reduce((s, ms, i) => (i % 2 === 0 ? s + Math.round((l[i + 1]! - ms) / MIN) : s), 0) : null, marcacoes: l.map(hh), atrasoMin: 0, saidaAntecipadaMin: 0, horaExtraMin: 0, intervaloRealizadoMin: null, codigos: [ausente(colab, d) ? 'MARCACAO_EM_AUSENCIA' : 'MARCACAO_EM_FOLGA'] });
    }
  }
  dias.sort((a, b) => a.colaboradorId.localeCompare(b.colaboradorId) || a.data.localeCompare(b.data));

  const resumo: ResumoColaboradorConciliacao[] = [...nomes].map(([id, nome]) => {
    const meus = dias.filter((d) => d.colaboradorId === id);
    const previstos = meus.filter((d) => d.previstoLiquidoMin > 0);
    return {
      colaboradorId: id, nome, diasPrevistos: previstos.length, diasSemMarcacao: previstos.filter((d) => d.codigos.includes('SEM_MARCACAO')).length,
      previstoMin: previstos.reduce((s, d) => s + d.previstoLiquidoMin, 0), apuradoMin: meus.reduce((s, d) => s + (d.apuradoMin ?? 0), 0),
      atrasoMin: meus.reduce((s, d) => s + d.atrasoMin, 0), horaExtraMin: meus.reduce((s, d) => s + d.horaExtraMin, 0), diasComDivergencia: meus.filter((d) => d.codigos.length > 0).length,
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { dias, resumo };
}

export const ROTULO_CONCILIACAO: Record<CodigoConciliacao, string> = {
  SEM_MARCACAO: 'Sem marcação (possível falta)', MARCACAO_IMPAR: 'Marcações em número ímpar', ATRASO: 'Atraso', SAIDA_ANTECIPADA: 'Saída antecipada',
  HORA_EXTRA_REALIZADA: 'Tempo além do turno', INTERVALO_REDUZIDO: 'Intervalo menor que o previsto', MARCACAO_EM_FOLGA: 'Marcação em dia de folga', MARCACAO_EM_AUSENCIA: 'Marcação durante férias/afastamento',
};
