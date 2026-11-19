'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps, ReactNode } from 'react';
import { TabelaDados } from './TabelaDados';

/** Texto da primeira coluna como link de verdade (teclado, abrir em nova aba). Sem `href`, vira texto simples. */
export function CelulaLink({ href, children }: { href?: string; children: ReactNode }) {
  return href ? <Link href={href} className="font-semibold hover:text-marca hover:underline">{children}</Link> : <span className="font-semibold">{children}</span>;
}

/** Lista enxuta: a linha inteira é clicável e leva à tela do item (`href` devolve o endereço; sem ele a lista é só de leitura). */
export function TabelaLista<T>({ href, ...p }: Omit<ComponentProps<typeof TabelaDados<T>>, 'aoClicarLinha'> & { href?: (linha: T) => string }) {
  const router = useRouter();
  return <TabelaDados {...p} aoClicarLinha={href ? (l) => router.push(href(l)) : undefined} />;
}
