'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';

export type LinhaVersao = {
  id: string; rotulo: string; status: 'rascunho' | 'publicada' | 'substituida'; publicacao: string; hash: string | null;
  atual: boolean; hrefAbrir: string; hrefComparar: string | null;
};
const tom = { rascunho: 'amarelo', publicada: 'verde', substituida: 'cinza' } as const;
const rotulo = { rascunho: 'Rascunho', publicada: 'Publicada', substituida: 'Substituída' } as const;
const naoNavegarDuasVezes = (e: React.MouseEvent) => e.stopPropagation();   // o clique na linha abre a escala; o link da célula tem destino próprio

/** Versões da escala: qual é, situação e quando foi publicada. Clicar abre a versão; "Comparar" leva à aba "O que mudou". */
export function TabelaVersoes({ dados }: { dados: LinhaVersao[] }) {
  const colunas: ColumnDef<LinhaVersao, unknown>[] = [
    {
      accessorKey: 'rotulo', header: 'Versão', enableSorting: false,
      cell: (c) => <span className="inline-flex flex-wrap items-center gap-2"><CelulaLink href={c.row.original.hrefAbrir}>{c.getValue() as string}</CelulaLink>{c.row.original.atual ? <span className="rounded-full bg-marca-suave px-2 py-0.5 text-[10px] font-bold uppercase text-marca">esta</span> : null}</span>,
    },
    { id: 'situacao', header: 'Situação', enableSorting: false, accessorFn: (r) => rotulo[r.status], cell: (c) => <Selo tom={tom[c.row.original.status]}>{c.getValue() as string}</Selo> },
    { accessorKey: 'publicacao', header: 'Publicação', enableSorting: false },
    {
      id: 'comparar', header: '', enableSorting: false,
      cell: (c) => c.row.original.hrefComparar ? <Link href={c.row.original.hrefComparar} onClick={naoNavegarDuasVezes} className="whitespace-nowrap text-sm font-semibold text-marca hover:underline" aria-label={`Comparar com ${c.row.original.rotulo}`}>Comparar</Link> : null,
    },
    { accessorKey: 'hash', header: 'Código' },   // oculta: só para a busca (código de integridade da publicação)
  ];
  return <TabelaLista colunas={colunas} dados={dados} colunasOcultas={['hash']} href={(l) => l.hrefAbrir} rotuloBusca="Buscar versão" tamanhoPagina={50} vazio="Sem versões." />;
}
