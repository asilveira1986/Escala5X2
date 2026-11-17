'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { dataBr } from '@jc/rules-engine';
import { desligarColaborador, reativarColaborador } from '../actions';

export function PainelDesligamento({ empresaId, colaboradorId, nome, desligamento, hoje, admissao }: { empresaId: string; colaboradorId: string; nome: string; desligamento: string | null; hoje: string; admissao: string }) {
  const router = useRouter();
  const [data, setData] = useState(hoje);
  const [confirmando, setConfirmando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  const executar = (fn: () => Promise<{ ok: true; mensagem: string } | { ok: false; erro: string }>) => iniciar(async () => {
    const r = await fn();
    setConfirmando(false);
    setMsg(r.ok ? { tipo: 'ok', texto: r.mensagem } : { tipo: 'erro', texto: r.erro });
    if (r.ok) router.refresh();
  });

  return (
    <div className="space-y-3">
      {desligamento ? (
        <>
          <p className="text-sm">Desligado em <strong>{dataBr(desligamento)}</strong> (último dia de trabalho). O contrato foi encerrado e o acesso ao aplicativo, removido.</p>
          <Botao variante="secundario" disabled={pendente} onClick={() => executar(() => reativarColaborador(empresaId, colaboradorId))}>{pendente ? 'Reativando…' : 'Reativar colaborador'}</Botao>
        </>
      ) : (
        <>
          <Campo rotulo="Último dia de trabalho" dica="O contrato termina nesta data e a pessoa deixa de contar a partir do dia seguinte">
            <input type="date" value={data} min={admissao} onChange={(e) => { setData(e.target.value); setConfirmando(false); }} className={`${classeCampo} max-w-xs`} />
          </Campo>
          {confirmando ? (
            <div role="alert" className="space-y-2 rounded-2xl bg-risco-bg px-4 py-3 text-sm text-risco-fg">
              <p>Desligar <strong>{nome}</strong> com último dia em <strong>{data ? dataBr(data) : '—'}</strong>? O acesso ao aplicativo será removido. Você pode reativar depois.</p>
              <div className="flex gap-2">
                <Botao variante="perigo" disabled={pendente} onClick={() => executar(() => desligarColaborador(empresaId, colaboradorId, data))}>{pendente ? 'Desligando…' : 'Confirmar desligamento'}</Botao>
                <Botao variante="secundario" disabled={pendente} onClick={() => setConfirmando(false)}>Cancelar</Botao>
              </div>
            </div>
          ) : <Botao variante="perigo" disabled={!data} onClick={() => setConfirmando(true)}>Desligar colaborador</Botao>}
        </>
      )}
      {msg ? <Aviso tipo={msg.tipo === 'ok' ? 'ok' : 'erro'}>{msg.texto}</Aviso> : null}
    </div>
  );
}
