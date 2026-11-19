'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Aviso, Botao } from './ui';

/** Remoção em dois passos (botão e confirmação na tela). Ao concluir, volta para a lista (`depoisPara`). `acao` devolve `erro` quando falha. */
export function RemoverItem({ acao, depoisPara, aviso, rotulo, confirmacao }: { acao: () => Promise<{ ok?: unknown; erro?: string }>; depoisPara: string; aviso: string; rotulo: string; confirmacao: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const remover = () => iniciar(async () => {
    const r = await acao();
    if (r.erro) { setErro(r.erro); setConfirmando(false); return; }
    router.push(depoisPara);
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-suave">{aviso}</p>
      {confirmando ? (
        <div role="alert" className="space-y-2 rounded-2xl bg-risco-bg px-4 py-3 text-sm text-risco-fg">
          <p>{confirmacao}</p>
          <div className="flex gap-2">
            <Botao variante="perigo" disabled={pendente} onClick={remover}>{pendente ? 'Removendo…' : 'Confirmar remoção'}</Botao>
            <Botao variante="secundario" disabled={pendente} onClick={() => setConfirmando(false)}>Cancelar</Botao>
          </div>
        </div>
      ) : <Botao variante="perigo" onClick={() => { setErro(null); setConfirmando(true); }}>{rotulo}</Botao>}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </div>
  );
}
