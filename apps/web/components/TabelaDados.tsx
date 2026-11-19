'use client';

import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useState } from 'react';
import { Botao, classeCampo } from './ui';

/** Tabela com busca, ordenação e paginação (TanStack Table), acessível por teclado. */
export function TabelaDados<T>({ colunas, dados, rotuloBusca = 'Buscar', tamanhoPagina = 25, vazio = 'Nenhum registro.', colunasOcultas = [], aoClicarLinha }: {
  colunas: ColumnDef<T, unknown>[]; dados: T[]; rotuloBusca?: string; tamanhoPagina?: number; vazio?: string;
  /** Ids de colunas que não aparecem, mas continuam valendo na busca (ex.: buscar pelo cargo sem mostrá-lo). */
  colunasOcultas?: string[];
  /** Torna a linha clicável (o conteúdo da linha deve ter um botão para quem usa teclado). */
  aoClicarLinha?: (linha: T) => void;
}) {
  const [ordem, setOrdem] = useState<SortingState>([]);
  const [filtro, setFiltro] = useState('');
  const tabela = useReactTable({
    data: dados, columns: colunas, state: { sorting: ordem, globalFilter: filtro },
    onSortingChange: setOrdem, onGlobalFilterChange: setFiltro,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: tamanhoPagina }, columnVisibility: Object.fromEntries(colunasOcultas.map((id) => [id, false])) },
  });
  const total = tabela.getFilteredRowModel().rows.length;
  return (
    <div className="space-y-2.5">
      <label className="block max-w-sm text-sm font-semibold">
        {rotuloBusca}
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} className={classeCampo} type="search" />
      </label>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="rotulo-col">
            {tabela.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => {
                  const s = h.column.getIsSorted();
                  return (
                    <th key={h.id} className="py-1.5 pr-3" aria-sort={s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : 'none'}>
                      {h.column.getCanSort()
                        ? <button type="button" onClick={h.column.getToggleSortingHandler()} className="font-bold uppercase hover:underline">{flexRender(h.column.columnDef.header, h.getContext())}{s === 'asc' ? ' ▲' : s === 'desc' ? ' ▼' : ''}</button>
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {tabela.getRowModel().rows.map((r) => (
              <tr key={r.id} className={`border-b border-linha ${aoClicarLinha ? 'cursor-pointer hover:bg-marca-suave' : ''}`} onClick={aoClicarLinha ? () => aoClicarLinha(r.original) : undefined}>
                {r.getVisibleCells().map((c) => <td key={c.id} className="py-1.5 pr-3 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
            {total === 0 && <tr><td colSpan={colunas.length} className="py-6 text-center text-suave">{vazio}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Botao variante="secundario" type="button" onClick={() => tabela.previousPage()} disabled={!tabela.getCanPreviousPage()}>Anterior</Botao>
        <Botao variante="secundario" type="button" onClick={() => tabela.nextPage()} disabled={!tabela.getCanNextPage()}>Próxima</Botao>
        <span aria-live="polite">Página {tabela.getState().pagination.pageIndex + 1} de {Math.max(1, tabela.getPageCount())} · {total} registros</span>
      </div>
    </div>
  );
}
