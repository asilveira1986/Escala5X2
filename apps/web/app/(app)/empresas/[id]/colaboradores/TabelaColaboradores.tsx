'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { IconeChevron } from '@/components/icones';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { Selo } from '@/components/ui';
import type { LinhaEquipe } from '@/lib/tipos-db';

type Estado = LinhaEquipe['acesso']['estado'];
const STATUS: Record<Estado, { rotulo: string; tom: 'verde' | 'amarelo' | 'cinza' }> = {
  com: { rotulo: 'Com acesso', tom: 'verde' },
  pendente: { rotulo: 'Convite enviado', tom: 'amarelo' },
  sem: { rotulo: 'Sem acesso', tom: 'cinza' },
};
const OCULTAS = ['cargo', 'tipo_escala', 'matricula'];

/** Na lista só o essencial (nome, setor e status). Clicar na linha abre a tela do colaborador, com todos os dados e a edição. */
export function TabelaColaboradores({ dados, empresaId, podeGerir }: { dados: LinhaEquipe[]; empresaId: string; podeGerir: boolean }) {
  const href = (l: LinhaEquipe) => `/empresas/${empresaId}/colaboradores/${l.colaborador_id}`;
  const colunas: ColumnDef<LinhaEquipe, unknown>[] = [
    {
      accessorKey: 'nome', header: 'Nome',
      // o nome é um link de verdade (teclado, abrir em nova aba); o clique no resto da linha também leva à tela
      cell: (c) => <CelulaLink href={podeGerir ? href(c.row.original) : undefined}>{c.getValue() as string}</CelulaLink>,
    },
    { accessorKey: 'setor_nome', header: 'Setor', cell: (c) => (c.getValue() as string | null) ?? '—' },
    { id: 'status', accessorFn: (r) => STATUS[r.acesso.estado].rotulo, header: 'Status', enableSorting: false, cell: (c) => <Selo tom={STATUS[c.row.original.acesso.estado].tom}>{c.getValue() as string}</Selo> },
    ...(podeGerir ? [{ id: 'abrir', header: '', enableSorting: false, cell: () => <IconeChevron aria-hidden width={16} height={16} className="ml-auto text-suave" /> } satisfies ColumnDef<LinhaEquipe, unknown>] : []),
    // ocultas: continuam valendo na busca (cargo, escala e matrícula)
    { accessorKey: 'cargo', header: 'Cargo' },
    { accessorKey: 'tipo_escala', header: 'Escala' },
    { accessorKey: 'matricula', header: 'Matrícula' },
  ];
  return (
    <TabelaLista colunas={colunas} dados={dados} colunasOcultas={OCULTAS} href={podeGerir ? href : undefined}
      rotuloBusca="Buscar colaborador" vazio="Nenhum colaborador com contrato vigente. Importe uma planilha." />
  );
}
