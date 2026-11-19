'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { StatusSolicitacao } from '@jc/servicos';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';
import { ROTULO_STATUS, TOM_STATUS } from '@/lib/solicitacoes-ui';

export type LinhaPedido = { id: string; pessoa: string; pedido: string; data: string; status: StatusSolicitacao; descricao: string };

/** Pedidos: quem pediu, o quê, quando e a situação. Clicar abre a tela do pedido (com a conferência das regras e a decisão). */
export function TabelaPedidos({ dados, empresaId, vazio }: { dados: LinhaPedido[]; empresaId: string; vazio: string }) {
  const href = (l: LinhaPedido) => `/empresas/${empresaId}/solicitacoes/${l.id}`;
  const colunas: ColumnDef<LinhaPedido, unknown>[] = [
    { accessorKey: 'pessoa', header: 'Pessoa', cell: (c) => <CelulaLink href={href(c.row.original)}>{c.getValue() as string}</CelulaLink> },
    { accessorKey: 'pedido', header: 'Pedido', enableSorting: false },
    { accessorKey: 'data', header: 'Pedido em', enableSorting: false },
    { accessorKey: 'status', header: 'Situação', enableSorting: false, cell: (c) => <Selo tom={TOM_STATUS[c.row.original.status]}>{ROTULO_STATUS[c.row.original.status]}</Selo> },
    { accessorKey: 'descricao', header: 'Descrição' },   // oculta: a busca acha pelas datas e pelo colega
  ];
  return <TabelaLista colunas={colunas} dados={dados} colunasOcultas={['descricao']} href={href} rotuloBusca="Buscar pedido" vazio={vazio} />;
}
