'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';
import { ROTULO_STATUS } from '@/lib/tipos-db';

export type LinhaEmpresaCarteira = {
  id: string; razao: string; cnpj: string; uf: string; pessoas: number; status: 'nao_iniciado' | 'em_risco' | 'adequado';
  pendencias: Array<{ codigo: string; texto: string; href: string }>;
};
const tom = { nao_iniciado: 'cinza', em_risco: 'amarelo', adequado: 'verde' } as const;
const naoNavegarDuasVezes = (e: React.MouseEvent) => e.stopPropagation();   // o clique na linha abre a empresa; cada pendência tem destino próprio
const VISIVEIS = 2;

/** Carteira: empresas das que mais precisam de atenção para as em dia, com as pendências à mão (cada uma leva à área certa). */
export function TabelaCarteira({ dados }: { dados: LinhaEmpresaCarteira[] }) {
  const href = (l: LinhaEmpresaCarteira) => `/empresas/${l.id}`;
  const colunas: ColumnDef<LinhaEmpresaCarteira, unknown>[] = [
    {
      accessorKey: 'razao', header: 'Empresa', enableSorting: false,
      cell: (c) => <div className="min-w-0"><CelulaLink href={href(c.row.original)}>{c.getValue() as string}</CelulaLink><p className="text-xs text-suave">{c.row.original.cnpj} · {c.row.original.uf}</p></div>,
    },
    { accessorKey: 'pessoas', header: 'Pessoas', enableSorting: false, cell: (c) => <span className="horario">{c.getValue() as number}</span> },
    {
      id: 'pendencias', header: 'Pendências', enableSorting: false, accessorFn: (r) => r.pendencias.map((p) => p.texto).join(' '),
      cell: (c) => {
        const p = c.row.original.pendencias;
        if (p.length === 0) return <span className="text-sm font-semibold text-ok-fg">Tudo em dia</span>;
        return (
          <ul className="space-y-0.5">
            {p.slice(0, VISIVEIS).map((x) => <li key={x.codigo}><Link href={x.href} onClick={naoNavegarDuasVezes} className="text-sm text-marca hover:underline">{x.texto}</Link></li>)}
            {p.length > VISIVEIS ? <li className="text-xs text-suave">+{p.length - VISIVEIS} {p.length - VISIVEIS === 1 ? 'pendência' : 'pendências'}</li> : null}
          </ul>
        );
      },
    },
    { id: 'situacao', header: 'Situação', enableSorting: false, accessorFn: (r) => ROTULO_STATUS[r.status], cell: (c) => <Selo tom={tom[c.row.original.status]}>{ROTULO_STATUS[c.row.original.status]}</Selo> },
    { id: 'cnpjBusca', header: 'CNPJ', accessorFn: (r) => r.cnpj.replace(/\D/g, '') },   // ocultas: a busca acha pelo CNPJ sem pontuação e pela UF
    { accessorKey: 'uf', header: 'UF' },
  ];
  return <TabelaLista colunas={colunas} dados={dados} colunasOcultas={['cnpjBusca', 'uf']} href={href} rotuloBusca="Buscar empresa" tamanhoPagina={25} vazio="Nenhuma empresa neste filtro." />;
}
