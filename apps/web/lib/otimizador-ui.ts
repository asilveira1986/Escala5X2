import type { ResumoProposta } from '@/app/(app)/empresas/[id]/escalas/actions';
import { duracao } from '@jc/rules-engine';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export type LinhaMetrica = { texto: string; tom: 'ok' | 'atencao' };

/** Frases curtas e em português para cada métrica da proposta. */
export function descreverMetricas(m: ResumoProposta['metricas'], alertas: number): LinhaMetrica[] {
  return [
    m.faltaCobertura === 0
      ? { texto: 'Cobertura mínima atendida em todas as faixas', tom: 'ok' }
      : { texto: `Falta cobertura: ${plural(m.faltaCobertura, 'vaga', 'vagas')} abaixo do mínimo`, tom: 'atencao' },
    m.deficitHorasMin === 0
      ? { texto: 'Todos fecham as horas contratadas', tom: 'ok' }
      : { texto: `Faltam ${duracao(m.deficitHorasMin)} para fechar as horas contratadas`, tom: 'atencao' },
    { texto: m.domingosMin === m.domingosMax ? `Domingos e feriados: ${m.domingosMax} por pessoa` : `Domingos e feriados por pessoa: de ${m.domingosMin} a ${m.domingosMax}`, tom: m.domingosMax - m.domingosMin <= 1 ? 'ok' : 'atencao' },
    ...(m.faltaIdeal > 0 ? [{ texto: `${plural(m.faltaIdeal, 'vaga', 'vagas')} abaixo da cobertura ideal`, tom: 'atencao' as const }] : []),
    ...(m.preferenciasNaoAtendidas > 0 ? [{ texto: `${plural(m.preferenciasNaoAtendidas, 'preferência não atendida', 'preferências não atendidas')}`, tom: 'atencao' as const }] : []),
    { texto: `Custo estimado do período: R$ ${m.custoReais.toLocaleString('pt-BR')}`, tom: 'ok' },
    ...(alertas > 0 ? [{ texto: `${plural(alertas, 'alerta', 'alertas')} para revisar (feriados trabalhados, por exemplo)`, tom: 'atencao' as const }] : []),
  ];
}

export const rotuloProposta = (indice: number, status: 'otima' | 'viavel') => `Proposta ${indice + 1}${indice === 0 ? ' (a melhor)' : ''} · ${status === 'otima' ? 'ótima' : 'viável'}`;

/** Quanto tempo esperar antes de desistir de acompanhar (o servidor encerra sozinho depois de 10 min). */
export const LIMITE_ACOMPANHAMENTO_MS = 5 * 60 * 1000;
