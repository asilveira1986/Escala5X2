'use client';

import { useState, useTransition } from 'react';
import type { SolicitacaoLinha } from '@jc/servicos';
import { Aviso, Botao, Campo, Cartao, classeCampo } from '@/components/ui';
import { descreverPedido } from '@/lib/solicitacoes-ui';
import { dataBr } from '@jc/rules-engine';
import { aprovarPedido, recusarPedido } from './actions';

export type PrevisaoVista = { resumo: string; erro?: string; bloqueios: number; alertas: number; problemas: Array<{ severidade: string; mensagem: string }>; conflitos: string[] };

/** Decisão do RH sobre o pedido: conferência das regras, aprovar e recusar (com motivo). Some quando o pedido não está mais pendente e não há mensagem a mostrar. */
export function DecisaoPedido({ s, empresaId, previsao }: { s: SolicitacaoLinha; empresaId: string; previsao: PrevisaoVista | null }) {
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const decidivel = s.status === 'pendente';
  const bloqueada = !!previsao && (previsao.bloqueios > 0 || !!previsao.erro);

  const aprovar = () => iniciar(async () => {
    setMsg(null);
    const r = await aprovarPedido(empresaId, s.id);
    setMsg(r.ok ? { tipo: 'ok', texto: r.mensagem } : { tipo: 'erro', texto: r.erro });
  });
  const recusar = () => iniciar(async () => {
    setMsg(null);
    const r = await recusarPedido(empresaId, s.id, motivo);
    if (r.ok) { setRecusando(false); setMsg({ tipo: 'ok', texto: r.mensagem }); } else setMsg({ tipo: 'erro', texto: r.erro });
  });

  if (!decidivel && !msg) return null;
  return (
    <Cartao titulo="Decisão">
      <div className="space-y-2">
        {decidivel && previsao ? (
          <div className="space-y-1.5">
            {previsao.erro ? <Aviso tipo="erro">{previsao.erro}</Aviso> : null}
            {!previsao.erro && previsao.bloqueios === 0 && previsao.problemas.length === 0 && previsao.conflitos.length === 0 ? <Aviso tipo="ok">A mudança respeita as regras da escala.</Aviso> : null}
            {previsao.problemas.map((p, i) => <Aviso key={i} tipo={p.severidade === 'bloqueio' ? 'erro' : 'info'}>{p.severidade === 'bloqueio' ? 'Violaria a lei: ' : 'Atenção: '}{p.mensagem}</Aviso>)}
            {previsao.conflitos.length > 0 ? <Aviso tipo="info">{previsao.conflitos.length} turno(s) já escalado(s) nesse período ({previsao.conflitos.slice(0, 5).map((d) => dataBr(d)).join(', ')}{previsao.conflitos.length > 5 ? '…' : ''}) precisam ser reorganizados na escala.</Aviso> : null}
          </div>
        ) : null}

        {decidivel ? (
          recusando ? (
            <div className="space-y-2">
              <Campo rotulo="Motivo da recusa (o colaborador vai ler)"><input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={classeCampo} /></Campo>
              <div className="flex gap-2">
                <Botao variante="perigo" onClick={recusar} disabled={pendente || motivo.trim().length < 3}>{pendente ? 'Recusando…' : 'Confirmar recusa'}</Botao>
                <Botao variante="secundario" onClick={() => setRecusando(false)} disabled={pendente}>Voltar</Botao>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Botao onClick={aprovar} disabled={pendente || bloqueada} aria-label={`Aprovar: ${descreverPedido(s)}`}>{pendente ? 'Aprovando…' : 'Aprovar'}</Botao>
              <Botao variante="secundario" onClick={() => setRecusando(true)} disabled={pendente} aria-label={`Recusar: ${descreverPedido(s)}`}>Recusar</Botao>
            </div>
          )
        ) : null}
        {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
      </div>
    </Cartao>
  );
}
