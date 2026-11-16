'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { fecharMes } from './actions';

export function BotaoFechar({ empresaId, mes, reabrir, podeFechar, motivoBloqueio }: { empresaId: string; mes: string; reabrir: boolean; podeFechar: boolean; motivoBloqueio?: string }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ciente, setCiente] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const confirmar = () => iniciar(async () => {
    setMsg(null);
    const r = await fecharMes(empresaId, mes, motivo);
    if (r.ok) { setAberto(false); setMotivo(''); setCiente(false); setMsg({ tipo: 'ok', texto: r.mensagem }); } else setMsg({ tipo: 'erro', texto: r.erro });
  });
  return (
    <div className="space-y-2">
      {!aberto ? (
        <div className="flex flex-wrap items-center gap-2">
          <Botao onClick={() => { setAberto(true); setMsg(null); }} disabled={!podeFechar}>{reabrir ? 'Fechar de novo (nova versão)' : 'Fechar o mês'}</Botao>
          {!podeFechar && motivoBloqueio ? <span className="text-sm text-suave">{motivoBloqueio}</span> : null}
        </div>
      ) : (
        <div className="space-y-2 rounded-2xl bg-fundo p-3">
          <p className="text-sm">O fechamento guarda um retrato destes números, que <strong>não pode ser editado</strong>. {reabrir ? 'Isso cria uma nova versão; a anterior continua guardada.' : 'Se precisar mudar depois, você reabre com um motivo.'}</p>
          {reabrir ? <Campo rotulo="Motivo da reabertura (fica registrado)"><input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={classeCampo} /></Campo> : null}
          <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} className="mt-0.5 size-5" />Conferi os avisos e as horas deste mês.</label>
          <div className="flex gap-2">
            <Botao onClick={confirmar} disabled={pendente || !ciente || (reabrir && motivo.trim().length < 5)}>{pendente ? 'Fechando…' : 'Confirmar fechamento'}</Botao>
            <Botao variante="secundario" onClick={() => setAberto(false)} disabled={pendente}>Cancelar</Botao>
          </div>
        </div>
      )}
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
    </div>
  );
}
