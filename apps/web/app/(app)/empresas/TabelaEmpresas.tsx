'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';
import { ROTULO_PORTE, ROTULO_STATUS, type EmpresaRow } from '@/lib/tipos-db';
import { formatarCnpj } from '@jc/connectors/parsers';

export type LinhaEmpresa = Pick<EmpresaRow, 'id' | 'razao_social' | 'cnpj' | 'porte' | 'uf' | 'status_adequacao'>;
const tom = { nao_iniciado: 'cinza', em_risco: 'amarelo', adequado: 'verde' } as const;

/** Empresas: nome, CNPJ e situação da adequação. Clicar abre a visão geral da empresa; porte e UF ficam na busca. */
export function TabelaEmpresas({ dados }: { dados: LinhaEmpresa[] }) {
  const href = (l: LinhaEmpresa) => `/empresas/${l.id}`;
  const colunas: ColumnDef<LinhaEmpresa, unknown>[] = [
    { accessorKey: 'razao_social', header: 'Empresa', cell: (c) => <CelulaLink href={href(c.row.original)}>{c.getValue() as string}</CelulaLink> },
    { id: 'cnpj', header: 'CNPJ', enableSorting: false, accessorFn: (r) => formatarCnpj(r.cnpj), cell: (c) => <span className="horario">{c.getValue() as string}</span> },
    { id: 'situacao', header: 'Situação', enableSorting: false, accessorFn: (r) => ROTULO_STATUS[r.status_adequacao], cell: (c) => <Selo tom={tom[c.row.original.status_adequacao]}>{c.getValue() as string}</Selo> },
    { id: 'porte', header: 'Porte', accessorFn: (r) => ROTULO_PORTE[r.porte] },   // ocultas: só para a busca
    { accessorKey: 'uf', header: 'UF' },
  ];
  return <TabelaLista colunas={colunas} dados={dados} colunasOcultas={['porte', 'uf']} href={href} rotuloBusca="Buscar empresa"
    vazio="Nenhuma empresa ainda. Use o botão Nova empresa; em seguida importe a planilha de colaboradores e receba o diagnóstico em poucos minutos." />;
}
