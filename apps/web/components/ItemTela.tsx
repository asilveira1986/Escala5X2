import type { ReactNode } from 'react';
import type { IconeId } from '@/lib/menu';
import { IconeCaixa } from './ui';

/** Cabeçalho da tela de um item (colaborador, turno, faixa, ausência…): ícone ou iniciais, título, uma linha de apoio e a situação à direita. */
export function CabecalhoItem({ icone, iniciais, titulo, subtitulo, selo }: { icone?: IconeId; iniciais?: string; titulo: string; subtitulo?: string; selo?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      {iniciais !== undefined
        ? <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-marca-suave text-lg font-bold text-marca">{iniciais}</span>
        : icone ? <span className="shrink-0"><IconeCaixa icone={icone} tamanho="lg" /></span> : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-bold leading-tight tracking-tight">{titulo}</h1>
        {subtitulo ? <p className="text-[13px] text-suave">{subtitulo}</p> : null}
      </div>
      {selo}
    </header>
  );
}

/** Faixa de resumo logo abaixo do cabeçalho: os números que a pessoa mais precisa, sempre à vista (use `className="horario"` nos valores em fonte mono). */
export function ResumoItem({ itens, rotulo }: { itens: Array<{ rotulo: string; valor: ReactNode }>; rotulo: string }) {
  return (
    <dl aria-label={rotulo} className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-linha bg-cartao p-3.5 shadow-card sm:grid-cols-4 sm:p-4">
      {itens.map((i) => <div key={i.rotulo} className="min-w-0"><dt className="rotulo-col">{i.rotulo}</dt><dd className="mt-0.5 truncate text-sm font-semibold">{i.valor}</dd></div>)}
    </dl>
  );
}
