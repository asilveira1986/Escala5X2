'use client';

import { useEffect } from 'react';
import { Botao } from './ui';

/** Erro de carregamento de código (acontece logo depois de uma nova versão do sistema): recarregar resolve. */
export const ehErroDeCarga = (e: { message?: string; name?: string }) => /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Failed to fetch dynamically/i.test(`${e.name ?? ''} ${e.message ?? ''}`);

/** Tela de erro amigável: tenta recarregar sozinha uma vez se for erro de carga, e mostra o motivo para facilitar o suporte. */
export function ErroTela({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!ehErroDeCarga(error)) return;
    try {
      if (sessionStorage.getItem('jc-recarregou') === '1') return;
      sessionStorage.setItem('jc-recarregou', '1');
      location.reload();
    } catch { /* sem sessionStorage: mostra a tela normal */ }
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-lg space-y-3 rounded-2xl border border-linha bg-cartao p-6 text-center shadow-card">
      <h1 className="text-xl font-bold">Algo deu errado ao abrir esta tela</h1>
      <p className="text-sm text-suave">Isso costuma passar ao recarregar a página (principalmente logo depois de o sistema ser atualizado). Se continuar, envie a mensagem abaixo ao suporte.</p>
      <div className="flex justify-center gap-2">
        <Botao onClick={() => location.reload()}>Recarregar a página</Botao>
        <Botao variante="secundario" onClick={reset}>Tentar de novo</Botao>
      </div>
      <p className="break-words rounded-xl bg-fundo px-3 py-2 text-left font-mono text-xs text-suave">{error.message || 'Erro sem mensagem'}{error.digest ? ` · ${error.digest}` : ''}</p>
    </div>
  );
}
