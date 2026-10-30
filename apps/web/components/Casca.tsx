import Link from 'next/link';
import type { ReactNode } from 'react';
import { MarcaLogo } from './icones';

/** Estrutura geral do aplicativo: barra superior leve e conteúdo centralizado. */
export function Casca({ email, children }: { email: string; children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-linha bg-cartao/90 backdrop-blur">
        <nav aria-label="Principal" className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-1.5 sm:px-6">
          <Link href="/empresas" className="flex items-center gap-2.5 rounded-lg" aria-label="JornadaCerta, ir para empresas">
            <MarcaLogo tamanho={26} />
            <span className="font-[family-name:var(--font-titulo)] text-base font-bold tracking-tight">JornadaCerta</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden max-w-48 truncate text-sm text-suave sm:block" title={email}>{email}</span>
            <form action="/auth/sair" method="post">
              <button className="min-h-9 rounded-full px-3.5 text-sm font-semibold text-marca hover:bg-marca-suave">Sair</button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 pb-24 pt-4 sm:px-6 sm:pb-10 sm:pt-6">{children}</main>
    </>
  );
}
