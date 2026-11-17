'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { hrefSeguro, iconeDoTipo, tempoRelativo, type Notificacao } from '@/lib/notificacoes';
import { IconeSino } from './icones';
import { IconeCaixa } from './ui';

const INTERVALO_MS = 60_000;

/** Linha de uma notificação (usada no sino e na página de notificações). */
export function ItemNotificacao({ n, aoAbrir }: { n: Notificacao; aoAbrir?: (n: Notificacao) => void }) {
  const href = hrefSeguro(n.href);
  const corpo = (
    <>
      <IconeCaixa icone={iconeDoTipo(n.tipo)} tamanho="sm" />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${n.lida_em ? 'font-medium' : 'font-bold'}`}>{n.titulo}</span>
        {n.texto ? <span className="block text-xs text-suave">{n.texto}</span> : null}
        <span className="block text-xs text-suave">{tempoRelativo(n.criado_em)}</span>
      </span>
      {!n.lida_em ? <span role="img" aria-label="não lida" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-marca" /> : null}
    </>
  );
  const cls = `flex items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-fundo ${n.lida_em ? '' : 'bg-marca-suave/50'}`;
  return href
    ? <Link href={href} onClick={() => aoAbrir?.(n)} className={cls}>{corpo}</Link>
    : <button type="button" onClick={() => aoAbrir?.(n)} className={`${cls} w-full`}>{corpo}</button>;
}

async function marcar(ids?: string[]): Promise<void> {
  try { await fetch('/api/v1/notificacoes/lidas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ids ? { ids } : {}), keepalive: true }); } catch { /* sem rede: marca de novo na próxima */ }
}

/** Sino da barra de cima: número de não lidas (atualiza sozinho), lista ao clicar e "marcar todas como lidas". */
export function Sino({ naoLidasInicial = 0 }: { naoLidasInicial?: number }) {
  const [naoLidas, setNaoLidas] = useState(naoLidasInicial);
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Notificacao[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const atualizarContagem = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    try { const r = await fetch('/api/v1/notificacoes?contagem=1', { cache: 'no-store' }); if (r.ok) setNaoLidas(Number(((await r.json()) as { naoLidas?: number }).naoLidas ?? 0)); } catch { /* offline */ }
  }, []);
  useEffect(() => {
    const t = setInterval(atualizarContagem, INTERVALO_MS);
    window.addEventListener('focus', atualizarContagem);
    return () => { clearInterval(t); window.removeEventListener('focus', atualizarContagem); };
  }, [atualizarContagem]);

  const carregar = useCallback(async () => {
    setFalhou(false);
    try {
      const r = await fetch('/api/v1/notificacoes?limite=20', { cache: 'no-store' });
      if (!r.ok) throw new Error('falha');
      const j = (await r.json()) as { naoLidas: number; itens: Notificacao[] };
      setItens(j.itens); setNaoLidas(j.naoLidas);
    } catch { setFalhou(true); }
  }, []);
  useEffect(() => { if (aberto) void carregar(); }, [aberto, carregar]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const abrirItem = (n: Notificacao) => {
    setAberto(false);
    if (!n.lida_em) { setNaoLidas((c) => Math.max(0, c - 1)); setItens((l) => l?.map((x) => (x.id === n.id ? { ...x, lida_em: new Date().toISOString() } : x)) ?? null); void marcar([n.id]); }
  };
  const marcarTodas = async () => { setNaoLidas(0); setItens((l) => l?.map((x) => ({ ...x, lida_em: x.lida_em ?? new Date().toISOString() })) ?? null); await marcar(); };

  return (
    <div ref={caixa} className="relative">
      <button type="button" onClick={() => setAberto((a) => !a)} aria-haspopup="dialog" aria-expanded={aberto}
        aria-label={naoLidas > 0 ? `Notificações, ${naoLidas} não lida${naoLidas === 1 ? '' : 's'}` : 'Notificações'} className="relative grid size-11 place-items-center rounded-xl text-tinta hover:bg-fundo sm:size-10">
        <IconeSino />
        {naoLidas > 0 ? <span aria-hidden className="absolute right-1 top-1 grid min-w-5 place-items-center rounded-full bg-risco-fg px-1 text-[11px] font-bold leading-5 text-cartao">{naoLidas > 99 ? '99+' : naoLidas}</span> : null}
      </button>
      {aberto ? (
        <div role="dialog" aria-label="Notificações" className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-1.5rem))] rounded-3xl border border-linha bg-cartao p-2 shadow-2xl">
          <div className="flex items-center justify-between px-3 py-2">
            <h2 className="text-sm font-bold">Notificações</h2>
            <button type="button" onClick={marcarTodas} disabled={naoLidas === 0} className="text-xs font-semibold text-marca hover:underline disabled:cursor-not-allowed disabled:text-suave disabled:no-underline">Marcar todas como lidas</button>
          </div>
          <div className="max-h-[min(26rem,70vh)] space-y-0.5 overflow-y-auto">
            {falhou ? <p className="px-3 py-4 text-sm text-suave">Não foi possível carregar agora. <button type="button" onClick={() => void carregar()} className="font-semibold text-marca underline">Tentar de novo</button></p>
              : itens === null ? <p className="px-3 py-4 text-sm text-suave">Carregando…</p>
              : itens.length === 0 ? <p className="px-3 py-6 text-center text-sm text-suave">Nada por aqui. Quando houver novidade, ela aparece neste sino.</p>
              : itens.map((n) => <ItemNotificacao key={n.id} n={n} aoAbrir={abrirItem} />)}
          </div>
          <div className="border-t border-linha px-3 pt-2 text-center"><Link href="/notificacoes" onClick={() => setAberto(false)} className="text-sm font-semibold text-marca hover:underline">Ver todas</Link></div>
        </div>
      ) : null}
    </div>
  );
}
