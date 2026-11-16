import { dataBr, hhmm, type DataISO } from '@jc/rules-engine';
import type { StatusSolicitacao, SolicitacaoLinha, TipoSolicitacao } from '@jc/servicos';

export const ROTULO_TIPO: Record<TipoSolicitacao, string> = {
  troca_turno: 'Troca de turno com colega', troca_folga: 'Troca de folga', ferias: 'Férias', afastamento: 'Afastamento (atestado)',
};
export const ROTULO_STATUS: Record<StatusSolicitacao, string> = {
  aguardando_colega: 'Aguardando o colega', pendente: 'Aguardando o RH', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada',
};
export const TOM_STATUS: Record<StatusSolicitacao, 'amarelo' | 'verde' | 'vermelho' | 'cinza'> = {
  aguardando_colega: 'amarelo', pendente: 'amarelo', aprovada: 'verde', recusada: 'vermelho', cancelada: 'cinza',
};
export const ABERTA = (s: Pick<SolicitacaoLinha, 'status'>) => s.status === 'aguardando_colega' || s.status === 'pendente';

/** Frase curta descrevendo o pedido (sem expor nada além do que está no payload). */
export function descreverPedido(s: Pick<SolicitacaoLinha, 'tipo' | 'payload' | 'solicitante_nome' | 'destinatario_nome'>): string {
  const p = s.payload as Record<string, string>;
  switch (s.tipo) {
    case 'troca_turno':
      return p.dataSolicitante === p.dataColega
        ? `${s.solicitante_nome} e ${s.destinatario_nome} trocam de turno em ${dataBr(p.dataSolicitante!)}`
        : `${s.solicitante_nome} cede o turno de ${dataBr(p.dataSolicitante!)} e assume o de ${dataBr(p.dataColega!)} de ${s.destinatario_nome}`;
    case 'troca_folga':
      return `${s.solicitante_nome} folga em ${dataBr(p.folgarEm!)} e trabalha em ${dataBr(p.trabalharEm!)}`;
    case 'ferias':
    case 'afastamento':
      return `${s.solicitante_nome}: ${s.tipo === 'ferias' ? 'férias' : 'afastamento'} de ${dataBr(p.inicio!)} a ${dataBr(p.fim!)}`;
  }
}

export const faixa = (ini: number | null, fim: number | null) => (ini == null || fim == null ? '' : `${hhmm(ini)}–${hhmm(fim)}`);

export type TurnoColega = { colaborador_id: string; nome: string; data: DataISO; inicio_min: number; fim_min: number; intervalo_min: number };

/** Opções do formulário de troca de turno: cada turno futuro de um colega, ordenado por data e nome. */
export function opcoesColega(turnos: TurnoColega[]): Array<{ valor: string; rotulo: string; colaboradorId: string; data: DataISO }> {
  return [...turnos].sort((a, b) => a.data.localeCompare(b.data) || a.nome.localeCompare(b.nome, 'pt-BR')).map((t) => ({
    valor: `${t.colaborador_id}|${t.data}`, rotulo: `${t.nome} · ${dataBr(t.data)} · ${faixa(t.inicio_min, t.fim_min)}`, colaboradorId: t.colaborador_id, data: t.data,
  }));
}
