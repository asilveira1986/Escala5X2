'use client';

import { useEffect, useState } from 'react';
import { Botao } from './ui';

type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const CHAVE = 'jc-instalar-dispensado';

/** Convite para instalar o app: botão nativo (Android/Chrome) ou instrução (iPhone/Safari). Some se já instalado ou dispensado. */
export function BotaoInstalar() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [ios, setIos] = useState(false);
  const [oculto, setOculto] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    let dispensado = false;
    try { dispensado = localStorage.getItem(CHAVE) === '1'; } catch { /* sem armazenamento */ }
    if (standalone || dispensado) return;
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent));
    setOculto(false);
    const antes = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar); };
    const instalado = () => setOculto(true);
    window.addEventListener('beforeinstallprompt', antes); window.addEventListener('appinstalled', instalado);
    return () => { window.removeEventListener('beforeinstallprompt', antes); window.removeEventListener('appinstalled', instalado); };
  }, []);

  if (oculto || (!evento && !ios)) return null;
  const dispensar = () => { try { localStorage.setItem(CHAVE, '1'); } catch { /* ignora */ } setOculto(true); };
  const instalar = async () => { if (!evento) return; await evento.prompt(); const r = await evento.userChoice; if (r.outcome === 'accepted') setOculto(true); setEvento(null); };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-linha bg-marca-suave px-4 py-3 text-sm">
      <span className="flex-1 font-medium">
        {evento ? 'Instale o app no seu celular para abrir a escala com um toque, até sem internet.' : 'Para instalar: toque em Compartilhar e depois em “Adicionar à Tela de Início”.'}
      </span>
      {evento ? <Botao onClick={instalar}>Instalar</Botao> : null}
      <Botao variante="secundario" onClick={dispensar}>Agora não</Botao>
    </div>
  );
}
