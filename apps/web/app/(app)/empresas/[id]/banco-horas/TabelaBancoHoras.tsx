'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';
import { ROTULO_SITUACAO_BANCO, saldoTexto, TOM_SITUACAO_BANCO, type SituacaoBanco } from '@/lib/banco-horas-ui';

export type LinhaBanco = { id: string; nome: string; saldoMin: number | null; situacao: SituacaoBanco; valorCentavos: number };
const moeda = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Banco de horas: pessoa, saldo e situação (com a estimativa a pagar quando há horas vencidas). Clicar abre a tela da pessoa. */
export function TabelaBancoHoras({ dados, empresaId }: { dados: LinhaBanco[]; empresaId: string }) {
  const href = (l: LinhaBanco) => `/empresas/${empresaId}/banco-horas/${l.id}`;
  const colunas: ColumnDef<LinhaBanco, unknown>[] = [
    { accessorKey: 'nome', header: 'Pessoa', cell: (c) => <CelulaLink href={href(c.row.original)}>{c.getValue() as string}</CelulaLink> },
    {
      id: 'saldo', header: 'Saldo', enableSorting: false, accessorFn: (r) => (r.saldoMin === null ? '—' : saldoTexto(r.saldoMin)),
      cell: (c) => <span className={`horario font-semibold ${(c.row.original.saldoMin ?? 0) < 0 ? 'text-risco-fg' : ''}`}>{c.getValue() as string}</span>,
    },
    {
      id: 'situacao', header: 'Situação', enableSorting: false, accessorFn: (r) => ROTULO_SITUACAO_BANCO[r.situacao],
      cell: (c) => {
        const l = c.row.original;
        return <span className="inline-flex flex-wrap items-center gap-2"><Selo tom={TOM_SITUACAO_BANCO[l.situacao]}>{c.getValue() as string}</Selo>{l.valorCentavos > 0 ? <span className="horario text-xs text-suave">≈ {moeda(l.valorCentavos)}</span> : null}</span>;
      },
    },
  ];
  return <TabelaLista colunas={colunas} dados={dados} href={href} rotuloBusca="Buscar pessoa" vazio="Nenhum lançamento ainda. Abra um colaborador para lançar a primeira hora no banco." />;
}
