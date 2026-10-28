import Link from 'next/link';
import type { ReactNode } from 'react';
import { exigirUsuario } from '@/lib/contexto';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await exigirUsuario();
  return (
    <>
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <nav aria-label="Principal" className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
          <Link href="/empresas" className="text-base font-bold text-blue-800 dark:text-blue-300">JornadaCerta</Link>
          <Link href="/empresas" className="hover:underline">Empresas</Link>
          <span className="ml-auto text-slate-600 dark:text-slate-400">{user.email}</span>
          <form action="/auth/sair" method="post"><button className="rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">Sair</button></form>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">{children}</main>
    </>
  );
}
