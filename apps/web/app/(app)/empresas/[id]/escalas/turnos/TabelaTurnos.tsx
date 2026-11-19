'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CelulaLink, TabelaLista } from '@/components/TabelaLista';
import { duracao, hhmm } from '@jc/rules-engine';

export type LinhaTurno = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number };

/** Turnos: nome, horário e jornada líquida. Clicar abre a tela do turno (editar e remover). */
export function TabelaTurnos({ dados, empresaId }: { dados: LinhaTurno[]; empresaId: string }) {
  const href = (l: LinhaTurno) => `/empresas/${empresaId}/escalas/turnos/${l.id}`;
  const colunas: ColumnDef<LinhaTurno, unknown>[] = [
    { accessorKey: 'nome', header: 'Turno', cell: (c) => <CelulaLink href={href(c.row.original)}>{c.getValue() as string}</CelulaLink> },
    { id: 'horario', header: 'Horário', enableSorting: false, accessorFn: (r) => `${hhmm(r.inicio_min)}–${hhmm(r.fim_min)}`, cell: (c) => <span className="horario">{c.getValue() as string}</span> },
    { id: 'liquidas', header: 'Jornada líquida', enableSorting: false, accessorFn: (r) => duracao(r.fim_min - r.inicio_min - r.intervalo_min) },
  ];
  return <TabelaLista colunas={colunas} dados={dados} href={href} rotuloBusca="Buscar turno" vazio="Nenhum turno ainda. Cadastre o primeiro com o botão Novo turno." />;
}
