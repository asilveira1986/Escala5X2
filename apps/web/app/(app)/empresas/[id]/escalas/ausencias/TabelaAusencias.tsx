'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';
import { ROTULO_SITUACAO, TOM_SITUACAO, type SituacaoAusencia } from '@/lib/ausencias';

export type LinhaAusencia = { id: string; pessoa: string; tipo: 'ferias' | 'afastamento'; periodo: string; situacao: SituacaoAusencia };

/** Férias e afastamentos: pessoa, tipo, período e situação. Clicar abre a tela do lançamento. */
export function TabelaAusencias({ dados, empresaId, podeGerir }: { dados: LinhaAusencia[]; empresaId: string; podeGerir: boolean }) {
  const href = (l: LinhaAusencia) => `/empresas/${empresaId}/escalas/ausencias/${l.id}`;
  const colunas: ColumnDef<LinhaAusencia, unknown>[] = [
    { accessorKey: 'pessoa', header: 'Pessoa', cell: (c) => <CelulaLink href={podeGerir ? href(c.row.original) : undefined}>{c.getValue() as string}</CelulaLink> },
    { accessorKey: 'tipo', header: 'Tipo', enableSorting: false, cell: (c) => <Selo tom={c.row.original.tipo === 'ferias' ? 'azul' : 'amarelo'}>{c.row.original.tipo === 'ferias' ? 'Férias' : 'Afastamento'}</Selo> },
    { accessorKey: 'periodo', header: 'Período', enableSorting: false },
    { accessorKey: 'situacao', header: 'Situação', enableSorting: false, cell: (c) => <Selo tom={TOM_SITUACAO[c.row.original.situacao]}>{ROTULO_SITUACAO[c.row.original.situacao]}</Selo> },
  ];
  return <TabelaLista colunas={colunas} dados={dados} href={podeGerir ? href : undefined} rotuloBusca="Buscar pessoa" vazio="Nenhuma ausência lançada. Lance as férias programadas para o editor evitar escalar quem está fora." />;
}
