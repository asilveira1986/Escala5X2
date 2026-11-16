'use client';

import { useState, useTransition } from 'react';
import type { Lancamento } from '@jc/servicos';
import { Aviso, Botao, Campo, classeCampo, Selo } from '@/components/ui';
import { estornados, horasTexto, ROTULO_ORIGEM, saldoTexto } from '@/lib/banco-horas-ui';
import { dataBr } from '@jc/rules-engine';
import { estornar } from './actions';

/** Extrato do livro-razão. Com `empresaId`, o RH pode estornar; sem ele, só leitura (colaborador). */
export function Extrato({ lancamentos, empresaId }: { lancamentos: Lancamento[]; empresaId?: string }) {
  const [alvo, setAlvo] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const ja = estornados(lancamentos);
  const ordenados = [...lancamentos].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
  const confirmar = () => iniciar(async () => {
    if (alvo == null || !empresaId) return;
    const r = await estornar(empresaId, alvo, motivo);
    setMsg(r.ok ? { tipo: 'ok', texto: r.mensagem } : { tipo: 'erro', texto: r.erro });
    if (r.ok) { setAlvo(null); setMotivo(''); }
  });
  return (
    <div className="space-y-2">
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs font-semibold uppercase tracking-wide text-suave"><tr><th className="py-1.5 pr-3">Data</th><th className="pr-3">Tipo</th><th className="pr-3 text-right">Horas</th><th className="pr-3">Vence em</th><th className="pr-3">Descrição</th>{empresaId ? <th /> : null}</tr></thead>
          <tbody className="divide-y divide-linha">
            {ordenados.map((l) => (
              <tr key={l.id} className={ja.has(l.id) ? 'text-suave line-through decoration-suave/50' : ''}>
                <td className="py-1.5 pr-3 whitespace-nowrap">{dataBr(l.data)}</td>
                <td className="pr-3">{ROTULO_ORIGEM[l.origem]}{ja.has(l.id) ? <> <Selo tom="cinza">estornado</Selo></> : null}</td>
                <td className={`pr-3 text-right font-semibold ${l.minutos > 0 ? 'text-ok-fg' : 'text-risco-fg'}`}>{saldoTexto(l.minutos)}</td>
                <td className="pr-3 whitespace-nowrap">{l.vence_em && l.minutos > 0 ? dataBr(l.vence_em) : '—'}</td>
                <td className="pr-3">{l.descricao ?? ''}</td>
                {empresaId ? <td className="text-right">{l.origem !== 'estorno' && !ja.has(l.id) ? <Botao variante="secundario" aria-label={`Estornar lançamento de ${horasTexto(Math.abs(l.minutos))} em ${dataBr(l.data)}`} onClick={() => { setAlvo(l.id); setMsg(null); }}>Estornar</Botao> : null}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {alvo != null ? (
        <div className="space-y-2 rounded-2xl bg-fundo p-3">
          <Campo rotulo="Motivo do estorno (fica registrado)"><input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={classeCampo} /></Campo>
          <div className="flex gap-2">
            <Botao variante="perigo" onClick={confirmar} disabled={pendente || motivo.trim().length < 3}>{pendente ? 'Estornando…' : 'Confirmar estorno'}</Botao>
            <Botao variante="secundario" onClick={() => setAlvo(null)} disabled={pendente}>Voltar</Botao>
          </div>
        </div>
      ) : null}
    </div>
  );
}
