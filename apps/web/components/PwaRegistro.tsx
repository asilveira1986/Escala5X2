'use client';

import { useEffect, useState } from 'react';

/**
 * Registra o service worker, avisa a ele quem está usando o aparelho (para não servir cópia de outra pessoa) e
 * mostra um aviso quando a conexão cai. `usuario` é o identificador curto do usuário (lib/pwa/uid.ts).
 */
export function PwaRegistro({ usuario }: { usuario: string }) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let ativo = true;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(async () => {
      const pronto = await navigator.serviceWorker.ready;
      if (ativo) pronto.active?.postMessage({ tipo: 'usuario', id: usuario });
    }).catch(() => undefined);   // sem service worker o app continua funcionando, só não abre offline
    return () => { ativo = false; };
  }, [usuario]);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const sobe = () => setOffline(false), cai = () => setOffline(true);
    window.addEventListener('online', sobe); window.addEventListener('offline', cai);
    return () => { window.removeEventListener('online', sobe); window.removeEventListener('offline', cai); };
  }, []);

  return offline ? (
    <div role="status" className="fixed inset-x-0 bottom-16 z-30 mx-auto w-fit max-w-[92vw] rounded-full bg-atencao-bg px-4 py-2 text-center text-sm font-semibold text-atencao-fg shadow-lg sm:bottom-4">
      Sem conexão: você vê a última versão salva neste aparelho.
    </div>
  ) : null;
}
