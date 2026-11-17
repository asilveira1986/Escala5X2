'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Aviso, Botao, classeCampo } from '@/components/ui';
import type { FormaPagamento } from '@jc/servicos';
import { assinar, cancelarAssinatura, trocarPlano, type ResultadoCobranca } from './actions';

const FORMAS: { v: FormaPagamento; t: string }[] = [{ v: 'pix', t: 'PIX' }, { v: 'boleto', t: 'Boleto' }, { v: 'cartao', t: 'Cartão de crédito' }, { v: 'indefinida', t: 'Escolher na hora de pagar' }];

/** Botão de um plano: "Assinar" (ou "Reativar") sem assinatura ativa, "Trocar para este plano" com assinatura em andamento. */
export function EscolhaPlano({ orgId, planoId, atual, emAndamento, rotulo }: { orgId: string; planoId: string; atual: boolean; emAndamento: boolean; rotulo: string }) {
  const router = useRouter();
  const [forma, setForma] = useState<FormaPagamento>('pix');
  const [msg, setMsg] = useState<ResultadoCobranca | null>(null);
  const [pendente, iniciar] = useTransition();
  const ir = () => iniciar(async () => {
    const r = emAndamento ? await trocarPlano(orgId, planoId) : await assinar(orgId, planoId, forma);
    setMsg(r);
    if (r.ok) router.refresh();
  });
  if (atual && emAndamento) return <p className="text-sm font-semibold text-ok-fg">Seu plano atual</p>;
  return (
    <div className="space-y-2">
      {!emAndamento ? (
        <label className="block text-xs font-semibold text-suave">Forma de pagamento
          <select value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)} className={`${classeCampo} mt-1`}>{FORMAS.map((f) => <option key={f.v} value={f.v}>{f.t}</option>)}</select>
        </label>
      ) : null}
      <Botao onClick={ir} disabled={pendente} className="w-full">{pendente ? 'Processando…' : emAndamento ? `Trocar para ${rotulo}` : `Assinar o plano ${rotulo}`}</Botao>
      {msg ? <Aviso tipo={msg.ok ? 'ok' : 'erro'}>{msg.ok ? msg.mensagem : msg.erro}</Aviso> : null}
    </div>
  );
}

export function CancelarAssinatura({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [msg, setMsg] = useState<ResultadoCobranca | null>(null);
  const [pendente, iniciar] = useTransition();
  const cancelar = () => iniciar(async () => { const r = await cancelarAssinatura(orgId); setMsg(r); setConfirmando(false); if (r.ok) router.refresh(); });
  return (
    <div className="space-y-2">
      {!confirmando ? <button type="button" onClick={() => setConfirmando(true)} className="text-sm font-semibold text-risco-fg hover:underline">Cancelar assinatura</button> : (
        <div role="alert" className="space-y-2 rounded-2xl bg-risco-bg px-4 py-3 text-sm text-risco-fg">
          <p>Cancelar a assinatura? As próximas cobranças deixam de ser geradas e o acesso à gestão é encerrado. Os seus dados continuam guardados.</p>
          <div className="flex gap-2"><Botao variante="perigo" onClick={cancelar} disabled={pendente}>{pendente ? 'Cancelando…' : 'Confirmar cancelamento'}</Botao><Botao variante="secundario" onClick={() => setConfirmando(false)} disabled={pendente}>Voltar</Botao></div>
        </div>
      )}
      {msg ? <Aviso tipo={msg.ok ? 'ok' : 'erro'}>{msg.ok ? msg.mensagem : msg.erro}</Aviso> : null}
    </div>
  );
}
