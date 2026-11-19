'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';
import { ROTULO_IMPORTACAO, TOM_IMPORTACAO, type StatusImportacao } from '@/lib/importacao-ui';

export type LinhaImportacao = { id: string; data: string; resultado: string; status: StatusImportacao };

/** Importações: data, resultado e situação. Clicar abre a tela da importação (relatório e erros). */
export function TabelaImportacoes({ dados, empresaId }: { dados: LinhaImportacao[]; empresaId: string }) {
  const href = (l: LinhaImportacao) => `/empresas/${empresaId}/importar/${l.id}`;
  const colunas: ColumnDef<LinhaImportacao, unknown>[] = [
    { accessorKey: 'data', header: 'Enviada em', enableSorting: false, cell: (c) => <CelulaLink href={href(c.row.original)}>{c.getValue() as string}</CelulaLink> },
    { accessorKey: 'resultado', header: 'Resultado', enableSorting: false },
    { id: 'situacao', header: 'Situação', enableSorting: false, accessorFn: (r) => ROTULO_IMPORTACAO[r.status], cell: (c) => <Selo tom={TOM_IMPORTACAO[c.row.original.status]}>{c.getValue() as string}</Selo> },
  ];
  return <TabelaLista colunas={colunas} dados={dados} href={href} rotuloBusca="Buscar importação" vazio="Nenhuma importação ainda. Envie a primeira planilha na aba Nova importação." />;
}
