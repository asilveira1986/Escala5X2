'use client';

/** Sair apaga as cópias offline do aparelho antes de encerrar a sessão (a escala é dado pessoal). */
export function BotaoSair() {
  const limpar = () => {
    try {
      navigator.serviceWorker?.controller?.postMessage({ tipo: 'limpar' });
      void caches?.keys().then((nomes) => nomes.filter((n) => n.startsWith('jc-paginas') || n === 'jc-meta').forEach((n) => void caches.delete(n)));
    } catch { /* sem cache no navegador: nada a limpar */ }
  };
  return (
    <form action="/auth/sair" method="post" onSubmit={limpar}>
      <button className="min-h-9 rounded-full px-3.5 text-sm font-semibold text-marca hover:bg-marca-suave">Sair</button>
    </form>
  );
}
