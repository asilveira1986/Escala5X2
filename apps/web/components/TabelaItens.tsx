'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { ItemDiagnostico } from '@jc/rules-engine';
import { data, horasMin, moedaHora, ROTULO_CLASSIFICACAO, ROTULO_EXCECAO } from '@jc/documents/formatar';
import { TabelaDados } from './TabelaDados';
import { Selo } from './ui';

const tom = { adequado: 'verde', adequacao_f1: 'vermelho', adequacao_f2: 'amarelo', excecao: 'azul' } as const;

const colunas: ColumnDef<ItemDiagnostico, unknown>[] = [
  { accessorKey: 'nome', header: 'Nome' },
  { accessorKey: 'setor', header: 'Setor', cell: (c) => (c.getValue() as string | null) ?? '—' },
  { accessorKey: 'classificacao', header: 'Situação', cell: (c) => { const i = c.row.original; return <><Selo tom={tom[i.classificacao]}>{ROTULO_CLASSIFICACAO[i.classificacao]}</Selo>{i.excecao ? <span className="ml-1 text-xs">({ROTULO_EXCECAO[i.excecao]})</span> : null}</>; } },
  { id: 'prazo', header: 'Prazo', accessorFn: (i) => (i.f1 && !i.f1.conforme ? i.f1.prazo : null), cell: (c) => data(c.getValue() as string | null) },
  { id: 'jornada', header: 'Jornada atual › F1 › F2', enableSorting: false, accessorFn: (i) => `${horasMin(i.horasAtuaisMin)} › ${horasMin((i.f1 ?? i.f2).horasAlvoMin)} › ${horasMin(i.f2.horasAlvoMin)}` },
  { id: 'hora', header: 'Valor/hora atual › F2', accessorFn: (i) => i.f2.valorHoraCentavos, cell: (c) => { const i = c.row.original; return `${moedaHora(i.valorHoraAtualCentavos)} › ${moedaHora(i.f2.valorHoraCentavos)}`; } },
  { id: 'divisor', header: 'Divisor', accessorFn: (i) => `${i.divisorAtual} › ${i.f2.divisor}` },
];

export function TabelaItens({ itens }: { itens: ItemDiagnostico[] }) {
  return <TabelaDados colunas={colunas} dados={itens} rotuloBusca="Buscar colaborador ou setor" tamanhoPagina={20} />;
}
