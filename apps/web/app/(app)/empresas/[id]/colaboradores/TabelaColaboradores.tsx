'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Selo } from '@/components/ui';
import { TabelaDados } from '@/components/TabelaDados';
import { decimal, horasMin, moeda, moedaHora } from '@jc/documents/formatar';
import type { LinhaEquipe } from '@/lib/tipos-db';
import { CelulaAcesso } from './CelulaAcesso';

const colunasBase: ColumnDef<LinhaEquipe, unknown>[] = [
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

export function TabelaColaboradores({ dados, empresaId, podeGerir }: { dados: LinhaEquipe[]; empresaId: string; podeGerir: boolean }) {
  const colunas: ColumnDef<LinhaEquipe, unknown>[] = [
    ...colunasBase,
    {
      id: 'acesso', header: 'Acesso ao app', enableSorting: false,
      cell: (c) => <CelulaAcesso empresaId={empresaId} colaboradorId={c.row.original.colaborador_id} nome={c.row.original.nome} acesso={c.row.original.acesso} podeGerir={podeGerir} />,
    },
    ...(podeGerir ? [{
      id: 'editar', header: '', enableSorting: false,
      cell: (c) => <Link href={`/empresas/${empresaId}/colaboradores/${c.row.original.colaborador_id}`} className="font-semibold text-marca hover:underline" aria-label={`Editar ${c.row.original.nome}`}>Editar</Link>,
    } satisfies ColumnDef<LinhaEquipe, unknown>] : []),
  ];
  return <TabelaDados colunas={colunas} dados={dados} rotuloBusca="Buscar colaborador" vazio="Nenhum colaborador com contrato vigente. Importe uma planilha." />;
}
