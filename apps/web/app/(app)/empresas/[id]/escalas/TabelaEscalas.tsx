'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';

export type LinhaEscala = { id: string; nome: string; versao: number; periodo: string; status: 'rascunho' | 'publicada' | 'substituida' };
const tom = { rascunho: 'amarelo', publicada: 'verde', substituida: 'cinza' } as const;
const rotulo = { rascunho: 'Rascunho', publicada: 'Publicada', substituida: 'Substituída' } as const;

/** Escalas do mês: nome, período e situação. Clicar abre o editor da escala. */
export function TabelaEscalas({ dados, empresaId }: { dados: LinhaEscala[]; empresaId: string }) {
  const href = (l: LinhaEscala) => `/empresas/${empresaId}/escalas/${l.id}`;
  const colunas: ColumnDef<LinhaEscala, unknown>[] = [
    { accessorKey: 'nome', header: 'Escala', cell: (c) => <CelulaLink href={href(c.row.original)}>{c.getValue() as string} <span className="font-normal text-suave">· versão {c.row.original.versao}</span></CelulaLink> },
    { accessorKey: 'periodo', header: 'Período', enableSorting: false },
    { accessorKey: 'status', header: 'Situação', enableSorting: false, cell: (c) => <Selo tom={tom[c.row.original.status]}>{rotulo[c.row.original.status]}</Selo> },
  ];
  return <TabelaLista colunas={colunas} dados={dados} href={href} rotuloBusca="Buscar escala" vazio="Nenhuma escala ainda. Crie a primeira com o botão Nova escala." />;
}
