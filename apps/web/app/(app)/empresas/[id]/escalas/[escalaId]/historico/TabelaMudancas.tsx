'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { TabelaDados } from '@/components/TabelaDados';

export type LinhaMudanca = { chave: string; data: string; pessoa: string; antes: string; depois: string };

/** O que mudou de uma versão para outra: dia, pessoa, como era e como ficou (com busca por pessoa). */
export function TabelaMudancas({ dados }: { dados: LinhaMudanca[] }) {
  const colunas: ColumnDef<LinhaMudanca, unknown>[] = [
    { accessorKey: 'data', header: 'Dia', enableSorting: false, cell: (c) => <span className="horario whitespace-nowrap">{c.getValue() as string}</span> },
    { accessorKey: 'pessoa', header: 'Colaborador', enableSorting: false, cell: (c) => <span className="font-semibold">{c.getValue() as string}</span> },
    { accessorKey: 'antes', header: 'Antes', enableSorting: false, cell: (c) => <span className="text-suave">{c.getValue() as string}</span> },
    { accessorKey: 'depois', header: 'Depois', enableSorting: false },
  ];
  return <TabelaDados colunas={colunas} dados={dados} rotuloBusca="Buscar colaborador" tamanhoPagina={30} vazio="Nenhuma mudança." />;
}
