import { numeroDoDia, type DataISO } from '@jc/rules-engine';

export type LinhaCarteira = {
  empresa_id: string; razao_social: string; cnpj: string; porte: string; uf: string; status_adequacao: 'nao_iniciado' | 'em_risco' | 'adequado';
  organizacao_nome: string | null; colaboradores: number; sem_contrato: number;
  diagnostico_id: string | null; diagnostico_em: string | null; diagnostico_total: number | null; diagnostico_a_adequar: number | null;
  escalas_publicadas: number; escalas_rascunho: number; ciencias_pendentes: number; sem_acesso: number; importacao_erro: boolean;
};

export type Pendencia = { codigo: string; texto: string; peso: number; aba: 'diagnostico' | 'escalas' | 'colaboradores' | 'importar' };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O que pede atenção numa empresa, da mais grave para a menos grave. */
export function pendencias(l: LinhaCarteira): Pendencia[] {
  const p: Pendencia[] = [];
  if (l.importacao_erro) p.push({ codigo: 'importacao', texto: 'A última importação deu erro', peso: 50, aba: 'importar' });
  if (l.colaboradores === 0 && l.sem_contrato === 0) p.push({ codigo: 'sem_equipe', texto: 'Nenhum colaborador cadastrado', peso: 40, aba: 'importar' });
  if (l.colaboradores > 0 && !l.diagnostico_id) p.push({ codigo: 'sem_diagnostico', texto: 'Diagnóstico ainda não gerado', peso: 45, aba: 'diagnostico' });
  if ((l.diagnostico_a_adequar ?? 0) > 0) p.push({ codigo: 'a_adequar', texto: `${plural(l.diagnostico_a_adequar!, 'pessoa precisa', 'pessoas precisam')} se adequar${l.diagnostico_total ? ` (de ${l.diagnostico_total})` : ''}`, peso: 35, aba: 'diagnostico' });
  if (l.sem_contrato > 0) p.push({ codigo: 'sem_contrato', texto: `${plural(l.sem_contrato, 'colaborador sem contrato vigente', 'colaboradores sem contrato vigente')}`, peso: 30, aba: 'colaboradores' });
  if (l.colaboradores > 0 && l.escalas_publicadas === 0 && l.escalas_rascunho === 0) p.push({ codigo: 'sem_escala', texto: 'Sem escala neste mês', peso: 25, aba: 'escalas' });
  if (l.escalas_rascunho > 0) p.push({ codigo: 'rascunho', texto: `${plural(l.escalas_rascunho, 'escala em rascunho', 'escalas em rascunho')}`, peso: 20, aba: 'escalas' });
  if (l.ciencias_pendentes > 0) p.push({ codigo: 'ciencia', texto: `${plural(l.ciencias_pendentes, 'ciência pendente', 'ciências pendentes')}`, peso: 15, aba: 'escalas' });
  if (l.sem_acesso > 0) p.push({ codigo: 'sem_acesso', texto: `${plural(l.sem_acesso, 'escalado sem acesso ao app', 'escalados sem acesso ao app')}`, peso: 10, aba: 'colaboradores' });
  return p.sort((a, b) => b.peso - a.peso);
}

export const pontuacao = (l: LinhaCarteira): number => pendencias(l).reduce((s, x) => s + x.peso, 0);

export type Filtro = 'todas' | 'atencao' | 'em_risco' | 'sem_diagnostico' | 'escala_pendente';
export const FILTROS: Array<{ id: Filtro; rotulo: string }> = [
  { id: 'todas', rotulo: 'Todas' }, { id: 'atencao', rotulo: 'Pedem atenção' }, { id: 'em_risco', rotulo: 'Em risco' },
  { id: 'sem_diagnostico', rotulo: 'Sem diagnóstico' }, { id: 'escala_pendente', rotulo: 'Escala pendente' },
];
export const lerFiltro = (v: unknown): Filtro => (FILTROS.some((f) => f.id === v) ? (v as Filtro) : 'todas');

const semDiagnostico = (l: LinhaCarteira) => l.colaboradores > 0 && !l.diagnostico_id;
const escalaPendente = (l: LinhaCarteira) => l.colaboradores > 0 && (l.escalas_publicadas === 0 || l.escalas_rascunho > 0);

export function filtrar(linhas: LinhaCarteira[], f: Filtro): LinhaCarteira[] {
  switch (f) {
    case 'atencao': return linhas.filter((l) => pontuacao(l) > 0);
    case 'em_risco': return linhas.filter((l) => l.status_adequacao === 'em_risco');
    case 'sem_diagnostico': return linhas.filter(semDiagnostico);
    case 'escala_pendente': return linhas.filter(escalaPendente);
    default: return linhas;
  }
}

/** Mais pendências primeiro; empate por nome. */
export const ordenarPorAtencao = (linhas: LinhaCarteira[]): LinhaCarteira[] =>
  [...linhas].sort((a, b) => pontuacao(b) - pontuacao(a) || a.razao_social.localeCompare(b.razao_social, 'pt-BR'));

export type ResumoCarteira = { empresas: number; atencao: number; emRisco: number; semDiagnostico: number; escalaPendente: number; cienciasPendentes: number; pessoas: number };
export function resumir(linhas: LinhaCarteira[]): ResumoCarteira {
  return {
    empresas: linhas.length, atencao: linhas.filter((l) => pontuacao(l) > 0).length, emRisco: linhas.filter((l) => l.status_adequacao === 'em_risco').length,
    semDiagnostico: linhas.filter(semDiagnostico).length, escalaPendente: linhas.filter(escalaPendente).length,
    cienciasPendentes: linhas.reduce((s, l) => s + l.ciencias_pendentes, 0), pessoas: linhas.reduce((s, l) => s + l.colaboradores, 0),
  };
}

export const diasAte = (alvo: DataISO, hoje: DataISO): number => numeroDoDia(alvo) - numeroDoDia(hoje);

/** "2027-03" ± n meses, e o primeiro dia do mês para consulta. */
export function lerMes(v: unknown, hoje: DataISO): { mes: string; dia: DataISO } {
  const m = typeof v === 'string' && /^(\d{4})-(0[1-9]|1[0-2])$/.test(v) ? v : hoje.slice(0, 7);
  return { mes: m, dia: `${m}-01` };
}
export function mesVizinho(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const t = a * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

const campo = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};

/** CSV para Excel pt-BR: separador ";", BOM UTF-8, e proteção contra fórmulas (=, +, -, @ no início). */
export function paraCsv(linhas: LinhaCarteira[]): string {
  const cab = ['Empresa', 'CNPJ', 'UF', 'Situação', 'Colaboradores', 'Sem contrato', 'Último diagnóstico', 'A adequar', 'Escalas publicadas (mês)', 'Escalas em rascunho (mês)', 'Ciências pendentes', 'Escalados sem acesso', 'Pendências'];
  const rot = { nao_iniciado: 'Não iniciado', em_risco: 'Em risco', adequado: 'Adequado' } as const;
  const corpo = linhas.map((l) => [
    l.razao_social, l.cnpj, l.uf, rot[l.status_adequacao], l.colaboradores, l.sem_contrato, l.diagnostico_em ?? '', l.diagnostico_a_adequar ?? '',
    l.escalas_publicadas, l.escalas_rascunho, l.ciencias_pendentes, l.sem_acesso, pendencias(l).map((p) => p.texto).join(' | '),
  ].map(campo).join(';'));
  return `﻿${[cab.join(';'), ...corpo].join('\r\n')}\r\n`;
}
