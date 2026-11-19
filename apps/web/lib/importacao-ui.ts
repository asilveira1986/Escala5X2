import type { ImportacaoRow } from '@/lib/tipos-db';

export type StatusImportacao = ImportacaoRow['status'];
export const ROTULO_IMPORTACAO: Record<StatusImportacao, string> = { aguardando_mapeamento: 'Aguardando confirmação', processando: 'Processando', concluida: 'Concluída', erro: 'Com falha' };
export const TOM_IMPORTACAO: Record<StatusImportacao, 'cinza' | 'amarelo' | 'verde' | 'vermelho'> = { aguardando_mapeamento: 'cinza', processando: 'amarelo', concluida: 'verde', erro: 'vermelho' };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Resultado em uma linha, para a lista de importações ("12 criados · 3 atualizados · 2 com erro"). */
export function resultadoImportacao(status: StatusImportacao, r: ImportacaoRow['relatorio']): string {
  if (status === 'erro') return r?.mensagem ? r.mensagem.slice(0, 80) : 'Nenhum dado foi gravado';
  if (status !== 'concluida' || !r) return '—';
  const partes = [plural(r.criados ?? 0, 'criado', 'criados'), plural(r.atualizados ?? 0, 'atualizado', 'atualizados')];
  if (r.errosTotal) partes.push(`${r.errosTotal} com erro`);
  return partes.join(' · ');
}
