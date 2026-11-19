'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';

export type LinhaCobertura = { id: string; dia: string; faixa: string; minimo: string; setor: string | null };

/** Cobertura mínima: dia, faixa, mínimo e setor, na ordem seg…dom. Clicar abre a tela da faixa. */
export function TabelaCobertura({ dados, empresaId, podeGerir }: { dados: LinhaCobertura[]; empresaId: string; podeGerir: boolean }) {
  const href = (l: LinhaCobertura) => `/empresas/${empresaId}/escalas/cobertura/${l.id}`;
  const colunas: ColumnDef<LinhaCobertura, unknown>[] = [
    { accessorKey: 'dia', header: 'Dia', enableSorting: false, cell: (c) => <CelulaLink href={podeGerir ? href(c.row.original) : undefined}>{c.getValue() as string}</CelulaLink> },
    { accessorKey: 'faixa', header: 'Faixa', enableSorting: false, cell: (c) => <span className="horario">{c.getValue() as string}</span> },
    { accessorKey: 'minimo', header: 'Mínimo', enableSorting: false },
    { accessorKey: 'setor', header: 'Setor', enableSorting: false, cell: (c) => <Selo tom={c.row.original.setor ? 'azul' : 'cinza'}>{c.row.original.setor ?? 'Empresa toda'}</Selo> },
  ];
  return <TabelaLista colunas={colunas} dados={dados} href={podeGerir ? href : undefined} tamanhoPagina={50} rotuloBusca="Buscar faixa" vazio="Nenhuma faixa ainda. Sem cobertura cadastrada, o editor não confere quantas pessoas há em cada horário." />;
}
