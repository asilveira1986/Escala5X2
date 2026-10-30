import Link from 'next/link';
import type { ReactNode } from 'react';
import { MarcaLogo } from './icones';

/** Estrutura geral do aplicativo: barra superior leve e conteúdo centralizado. */
export function Casca({ email, children }: { email: string; children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-linha bg-cartao/90 backdrop-blur">
        <nav aria-label="Principal" className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link href="/empresas" className="flex items-center gap-2.5 rounded-lg" aria-label="JornadaCerta, ir para empresas">
            <MarcaLogo />
            <span className="font-[family-name:var(--font-titulo)] text-lg font-bold tracking-tight">JornadaCerta</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden max-w-48 truncate text-sm text-suave sm:block" title={email}>{email}</span>
            <form action="/auth/sair" method="post">
              <button className="min-h-10 rounded-lg px-3 text-sm font-semibold text-marca hover:bg-marca-suave">Sair</button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 pb-28 pt-6 sm:px-6 sm:pb-12 sm:pt-8">{children}</main>
    </>
  );
}
