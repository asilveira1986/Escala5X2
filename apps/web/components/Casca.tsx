import Link from 'next/link';
import type { ReactNode } from 'react';
import { MarcaLogo } from './icones';

/** Estrutura geral do aplicativo: barra superior leve e conteúdo centralizado. */
export function Casca({ email, children, mfaDesligado = false, temMinhaEscala = false, temCarteira = false }: { email: string; children: ReactNode; mfaDesligado?: boolean; temMinhaEscala?: boolean; temCarteira?: boolean }) {
  return (
    <>
      {mfaDesligado ? (
        <div role="status" className="bg-atencao-bg px-4 py-2 text-center text-sm font-semibold text-atencao-fg">
          Modo de teste: a verificação em duas etapas está <strong>desativada</strong> neste ambiente. Não use dados reais.
        </div>
      ) : null}
      <header className="sticky top-0 z-20 border-b border-linha bg-cartao/90 backdrop-blur">
        <nav aria-label="Principal" className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-1.5 sm:px-6">
          <Link href="/empresas" className="flex items-center gap-2.5 rounded-lg" aria-label="JornadaCerta, ir para empresas">
            <MarcaLogo tamanho={26} />
            <span className="font-[family-name:var(--font-titulo)] text-base font-bold tracking-tight">JornadaCerta</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden max-w-48 truncate text-sm text-suave sm:block" title={email}>{email}</span>
            {temCarteira ? <Link href="/carteira" className="min-h-9 content-center rounded-full px-3.5 text-sm font-semibold text-marca hover:bg-marca-suave">Carteira</Link> : null}
            {temMinhaEscala ? <Link href="/minha-escala" className="min-h-9 content-center rounded-full px-3.5 text-sm font-semibold text-marca hover:bg-marca-suave">Minha escala</Link> : null}
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
