'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { IconeFechar } from './icones';

/**
 * Painel lateral (gaveta) para detalhes de um item da lista. Fecha com Esc, com o botão ou clicando fora;
 * trava a rolagem da página e devolve o foco ao elemento que a abriu.
 */
export function Gaveta({ aberta, onFechar, titulo, subtitulo, rodape, children }: { aberta: boolean; onFechar: () => void; titulo: string; subtitulo?: ReactNode; rodape?: ReactNode; children: ReactNode }) {
  const botao = useRef<HTMLButtonElement>(null);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    if (!aberta) return;
    const origem = document.activeElement as HTMLElement | null;
    botao.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar.current(); };
    document.addEventListener('keydown', esc);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = overflow; origem?.focus?.(); };
  }, [aberta]);

  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="gaveta-titulo">
      <button type="button" aria-label="Fechar" tabIndex={-1} className="absolute inset-0 bg-noite/50" onClick={onFechar} />
      <aside className="absolute inset-y-0 right-0 flex w-[min(30rem,100vw)] flex-col border-l border-linha bg-cartao shadow-pop">
        <header className="flex items-start justify-between gap-3 border-b border-linha p-4">
          <div className="min-w-0">
            <h2 id="gaveta-titulo" className="truncate text-lg font-bold leading-tight">{titulo}</h2>
            {subtitulo ? <div className="mt-1 text-[13px] text-suave">{subtitulo}</div> : null}
          </div>
          <button ref={botao} type="button" onClick={onFechar} aria-label="Fechar" className="grid size-10 shrink-0 place-items-center rounded-[10px] text-suave hover:bg-fundo"><IconeFechar /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">{children}</div>
        {rodape ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-linha p-4">{rodape}</footer> : null}
      </aside>
    </div>
  );
}
