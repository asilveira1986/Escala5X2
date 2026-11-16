import Link from 'next/link';

export const metadata = { title: 'Sem conexão · JornadaCerta' };

/** Página pública guardada pelo service worker: aparece quando não há internet e não há cópia da tela pedida. */
export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold">Você está sem conexão</h1>
      <p className="text-suave">Esta tela precisa de internet. A sua escala, se você já a abriu neste aparelho com conexão, continua disponível: volte para ela.</p>
      <Link href="/minha-escala" className="inline-flex min-h-11 items-center justify-center rounded-full bg-marca px-5 text-sm font-semibold text-sobre-marca">Abrir minha escala</Link>
      <p className="text-xs text-suave">Quando a conexão voltar, tudo se atualiza sozinho.</p>
    </main>
  );
}
