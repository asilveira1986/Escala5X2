'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconeEnviar, IconeGrafico, IconePessoas } from './icones';

const abas = [
  { slug: 'diagnostico', rotulo: 'Diagnóstico', Icone: IconeGrafico },
  { slug: 'colaboradores', rotulo: 'Equipe', Icone: IconePessoas },
  { slug: 'importar', rotulo: 'Importar', Icone: IconeEnviar },
] as const;

/** Abas no topo (telas grandes) e barra fixa embaixo (celular), com ícone e texto. */
export function NavEmpresa({ empresaId }: { empresaId: string }) {
  const caminho = usePathname();
  const ativa = (slug: string) => caminho.startsWith(`/empresas/${empresaId}/${slug}`);
  return (
    <>
      <nav aria-label="Seções da empresa" className="hidden gap-1 rounded-2xl border border-linha bg-cartao p-1.5 sm:inline-flex">
        {abas.map(({ slug, rotulo, Icone }) => (
          <Link key={slug} href={`/empresas/${empresaId}/${slug}`} aria-current={ativa(slug) ? 'page' : undefined}
            className={`flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${ativa(slug) ? 'bg-marca text-sobre-marca' : 'text-tinta hover:bg-marca-suave'}`}>
            <Icone width={18} height={18} />{rotulo}
          </Link>
        ))}
      </nav>
      <nav aria-label="Seções da empresa" className="fixed inset-x-0 bottom-0 z-20 border-t border-linha bg-cartao pb-[env(safe-area-inset-bottom,0px)] sm:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-3">
          {abas.map(({ slug, rotulo, Icone }) => (
            <li key={slug}>
              <Link href={`/empresas/${empresaId}/${slug}`} aria-current={ativa(slug) ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${ativa(slug) ? 'text-marca' : 'text-suave'}`}>
                <span className={`rounded-full px-4 py-1 ${ativa(slug) ? 'bg-marca-suave' : ''}`}><Icone /></span>{rotulo}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
