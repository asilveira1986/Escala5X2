'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';
import { situacaoDiagnostico } from '@/lib/diagnostico-ui';

export type LinhaDiagnostico = { id: string; referencia: string; pessoas: number | null; aAdequar: number | null; geradoEm: string };

/** Diagnósticos: data de referência, pessoas analisadas e situação. Clicar abre o diagnóstico; a data de geração fica na busca. */
export function TabelaDiagnosticos({ dados, empresaId }: { dados: LinhaDiagnostico[]; empresaId: string }) {
  const href = (l: LinhaDiagnostico) => `/empresas/${empresaId}/diagnostico/${l.id}`;
  const colunas: ColumnDef<LinhaDiagnostico, unknown>[] = [
    { accessorKey: 'referencia', header: 'Referência', enableSorting: false, cell: (c) => <CelulaLink href={href(c.row.original)}>{c.getValue() as string}</CelulaLink> },
    { id: 'pessoas', header: 'Pessoas', enableSorting: false, accessorFn: (r) => (r.pessoas === null ? '—' : String(r.pessoas)), cell: (c) => <span className="horario">{c.getValue() as string}</span> },
    { id: 'situacao', header: 'Situação', enableSorting: false, accessorFn: (r) => situacaoDiagnostico(r.aAdequar).rotulo, cell: (c) => <Selo tom={situacaoDiagnostico(c.row.original.aAdequar).tom}>{c.getValue() as string}</Selo> },
    { accessorKey: 'geradoEm', header: 'Gerado em' },   // oculta: só para a busca
  ];
  return <TabelaLista colunas={colunas} dados={dados} colunasOcultas={['geradoEm']} href={href} rotuloBusca="Buscar diagnóstico" vazio="Ainda não há diagnósticos. Use o botão Novo diagnóstico: leva alguns segundos." />;
}
