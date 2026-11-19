'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { TabelaDados } from '@/components/TabelaDados';
import { Selo } from '@/components/ui';
import { ROTULO_FATURA } from '@/lib/cobranca';

export type LinhaFatura = { id: string; vencimento: string; valor: string; forma: string; status: keyof typeof ROTULO_FATURA; pagoEm: string | null; url: string | null };
const tom = { pendente: 'amarelo', paga: 'verde', vencida: 'vermelho', estornada: 'cinza', cancelada: 'cinza' } as const;

/** Faturas: vencimento, valor, forma e situação, com o link para pagar (ou ver o recibo). */
export function TabelaFaturas({ dados }: { dados: LinhaFatura[] }) {
  const colunas: ColumnDef<LinhaFatura, unknown>[] = [
    { accessorKey: 'vencimento', header: 'Vencimento', enableSorting: false, cell: (c) => <span className="horario font-semibold">{c.getValue() as string}</span> },
    { accessorKey: 'valor', header: 'Valor', enableSorting: false, cell: (c) => <span className="horario">{c.getValue() as string}</span> },
    { accessorKey: 'forma', header: 'Forma', enableSorting: false },
    {
      id: 'situacao', header: 'Situação', enableSorting: false, accessorFn: (r) => ROTULO_FATURA[r.status],
      cell: (c) => { const f = c.row.original; return <span className="inline-flex flex-wrap items-center gap-2"><Selo tom={tom[f.status]}>{c.getValue() as string}</Selo>{f.pagoEm ? <span className="text-xs text-suave">em {f.pagoEm}</span> : null}</span>; },
    },
    {
      id: 'acao', header: '', enableSorting: false,
      cell: (c) => {
        const f = c.row.original;
        const rotulo = f.url && (f.status === 'pendente' || f.status === 'vencida') ? 'Pagar' : f.url && f.status === 'paga' ? 'Ver' : null;
        return rotulo ? <a href={f.url!} target="_blank" rel="noopener noreferrer" className="font-semibold text-marca hover:underline" aria-label={`${rotulo} a fatura de ${f.vencimento}`}>{rotulo}</a> : null;
      },
    },
  ];
  return <TabelaDados colunas={colunas} dados={dados} rotuloBusca="Buscar fatura" tamanhoPagina={12} vazio="Nenhuma fatura ainda. Depois de assinar, a primeira aparece aqui." />;
}
