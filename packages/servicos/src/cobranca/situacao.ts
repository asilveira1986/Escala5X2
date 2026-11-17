import type { StatusAssinatura } from './tipos';

export type EstadoConta = 'teste' | 'teste_expirado' | 'aguardando_pagamento' | 'ativa' | 'inadimplente' | 'suspensa' | 'cancelada';
export type EntradaSituacao = {
  status: StatusAssinatura; testeAte: string | null; hoje: string;
  /** Vencimento da fatura vencida mais antiga ainda não paga (para a carência). */
  vencidaDesde?: string | null;
  limiteColaboradores?: number | null; colaboradoresAtivos?: number;
  /** Só bloqueia o acesso quando a cobrança está ligada no ambiente (COBRANCA_ATIVA). */
  cobrancaAtiva: boolean; carenciaDias?: number;
};
export type Situacao = {
  estado: EstadoConta; bloqueado: boolean; diasTeste: number | null; diasAtraso: number | null;
  excedeLimite: boolean; aviso: { tom: 'info' | 'atencao' | 'risco'; texto: string } | null;
};

const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/**
 * Situação da conta para o aviso do sistema e para o bloqueio. Regras:
 *  - teste: grátis até `testeAte`; depois, sem assinatura, o acesso é bloqueado (se a cobrança estiver ligada);
 *  - inadimplente: segue funcionando durante a carência (7 dias após o vencimento da fatura mais antiga em aberto); depois, suspensa;
 *  - cancelada: bloqueada.
 * Com a cobrança desligada nada bloqueia (o sistema só mostra os avisos).
 */
export function situacaoDaConta(e: EntradaSituacao): Situacao {
  const carencia = e.carenciaDias ?? 7;
  const excede = e.limiteColaboradores != null && (e.colaboradoresAtivos ?? 0) > e.limiteColaboradores;
  const base = { diasTeste: null as number | null, diasAtraso: null as number | null, excedeLimite: excede };
  const bloq = (b: boolean) => b && e.cobrancaAtiva;

  if (e.status === 'teste') {
    const restam = e.testeAte ? dias(e.hoje, e.testeAte) : 0;
    if (restam < 0) return { ...base, estado: 'teste_expirado', bloqueado: bloq(true), aviso: { tom: 'risco', texto: 'O período de teste terminou. Escolha um plano em Plano e cobrança para continuar.' } };
    return { ...base, estado: 'teste', bloqueado: false, diasTeste: restam, aviso: { tom: restam <= 3 ? 'atencao' : 'info', texto: restam === 0 ? 'Seu teste grátis termina hoje.' : `Teste grátis: ${restam} dia${restam === 1 ? '' : 's'} restante${restam === 1 ? '' : 's'}.` } };
  }
  if (e.status === 'aguardando_pagamento') return { ...base, estado: 'aguardando_pagamento', bloqueado: false, aviso: { tom: 'info', texto: 'Aguardando o primeiro pagamento da assinatura.' } };
  if (e.status === 'inadimplente') {
    const atraso = e.vencidaDesde ? Math.max(0, dias(e.vencidaDesde, e.hoje)) : 0;
    if (atraso > carencia) return { ...base, diasAtraso: atraso, estado: 'suspensa', bloqueado: bloq(true), aviso: { tom: 'risco', texto: `Fatura vencida há ${atraso} dias: o acesso foi suspenso. Regularize em Plano e cobrança.` } };
    return { ...base, diasAtraso: atraso, estado: 'inadimplente', bloqueado: false, aviso: { tom: 'atencao', texto: `Há uma fatura vencida. Regularize em até ${Math.max(0, carencia - atraso)} dia(s) para não perder o acesso.` } };
  }
  if (e.status === 'cancelada') return { ...base, estado: 'cancelada', bloqueado: bloq(true), aviso: { tom: 'risco', texto: 'A assinatura está cancelada. Escolha um plano para voltar a usar o sistema.' } };
  return { ...base, estado: 'ativa', bloqueado: false, aviso: excede ? { tom: 'atencao', texto: `Você tem ${e.colaboradoresAtivos} colaboradores ativos e o plano inclui ${e.limiteColaboradores}. Mude de plano para ficar em dia.` } : null };
}
