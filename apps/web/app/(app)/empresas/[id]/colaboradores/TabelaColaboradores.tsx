'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Selo } from '@/components/ui';
import { TabelaDados } from '@/components/TabelaDados';
import { decimal, horasMin, moeda, moedaHora } from '@jc/documents/formatar';
import type { ColaboradorVigenteRow } from '@/lib/tipos-db';

const colunas: ColumnDef<ColaboradorVigenteRow, unknown>[] = [
  { accessorKey: 'nome', header: 'Nome' },
  { accessorKey: 'setor_nome', header: 'Setor', cell: (c) => (c.getValue() as string | null) ?? '—' },
  { accessorKey: 'cargo', header: 'Cargo', cell: (c) => (c.getValue() as string | null) ?? '—' },
  { accessorKey: 'tipo_escala', header: 'Escala' },
  { accessorKey: 'jornada_semanal_min', header: 'Jornada', cell: (c) => horasMin(c.getValue() as number) },
  { id: 'salario', accessorFn: (r) => Number(r.salario_base), header: 'Salário', cell: (c) => moeda(Math.round((c.getValue() as number) * 100)) },
  { id: 'hora', accessorFn: (r) => Number(r.salario_base) / r.divisor, header: 'Valor/hora', cell: (c) => moedaHora(Math.round((c.getValue() as number) * 100)) },
  { accessorKey: 'divisor', header: 'Divisor', cell: (c) => decimal(c.getValue() as number, 0) },
  { accessorKey: 'hipersuficiente', header: 'Alta renda', enableSorting: false, cell: (c) => (c.getValue() ? <Selo tom="azul">Alta renda</Selo> : null) },
];

export function TabelaColaboradores({ dados }: { dados: ColaboradorVigenteRow[] }) {
  return <TabelaDados colunas={colunas} dados={dados} rotuloBusca="Buscar colaborador" vazio="Nenhum colaborador com contrato vigente. Importe uma planilha." />;
}
