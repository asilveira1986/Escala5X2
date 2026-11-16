'use client';

import { useState, useTransition } from 'react';
import type { SolicitacaoLinha } from '@jc/servicos';
import { Aviso, Botao, Selo } from '@/components/ui';
import { ABERTA, descreverPedido, ROTULO_STATUS, ROTULO_TIPO, TOM_STATUS } from '@/lib/solicitacoes-ui';
import { dataBr } from '@jc/rules-engine';
import { cancelarPedido, responderPedido } from './actions';

/** Pedidos da própria pessoa (com Cancelar) ou dirigidos a ela (com Aceitar e Recusar). */
export function ListaPedidos({ pedidos, modo }: { pedidos: SolicitacaoLinha[]; modo: 'meus' | 'para-mim' }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const agir = (f: () => Promise<{ ok: boolean; erro?: string }>) => iniciar(async () => { setErro(null); const r = await f(); if (!r.ok) setErro(r.erro ?? 'Não foi possível concluir.'); });
  return (
    <div className="space-y-2">
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      <ul className="divide-y divide-linha">
        {pedidos.map((p) => (
          <li key={p.id} className="space-y-1.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{ROTULO_TIPO[p.tipo]}</span>
              <Selo tom={TOM_STATUS[p.status]}>{modo === 'para-mim' && p.status === 'aguardando_colega' ? 'Aguardando você' : ROTULO_STATUS[p.status]}</Selo>
            </div>
            <p className="text-sm">{descreverPedido(p)}</p>
            {p.motivo ? <p className="text-sm text-suave">Motivo: {p.motivo}</p> : null}
            {p.decisao_motivo ? <p className="text-sm text-suave">Resposta: {p.decisao_motivo}</p> : null}
            <p className="text-xs text-suave">Pedido em {dataBr(p.criado_em.slice(0, 10))}</p>
            {modo === 'meus' && ABERTA(p) ? <Botao variante="secundario" disabled={pendente} aria-label={`Cancelar pedido: ${descreverPedido(p)}`} onClick={() => agir(() => cancelarPedido(p.id))}>Cancelar pedido</Botao> : null}
            {modo === 'para-mim' && p.status === 'aguardando_colega' ? (
              <div className="flex gap-2">
                <Botao disabled={pendente} aria-label={`Aceitar a troca de ${p.solicitante_nome}`} onClick={() => agir(() => responderPedido(p.id, true))}>Aceitar troca</Botao>
                <Botao variante="secundario" disabled={pendente} aria-label={`Recusar a troca de ${p.solicitante_nome}`} onClick={() => agir(() => responderPedido(p.id, false))}>Recusar</Botao>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
