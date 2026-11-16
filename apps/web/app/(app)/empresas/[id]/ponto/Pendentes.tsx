'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao, classeCampo } from '@/components/ui';
import { dataBr } from '@jc/rules-engine';
import { vincularIdentificador } from './actions';

export type Pendente = { tipo: 'pis' | 'cpf'; identificador_hash: string; final4: string; marcacoes: number | string; primeira: string; ultima: string };

/** Identificadores do relógio que o sistema ainda não sabe de quem são: o RH escolhe o colaborador uma vez. */
export function Pendentes({ empresaId, pendentes, colaboradores }: { empresaId: string; pendentes: Pendente[]; colaboradores: Array<{ id: string; nome: string }> }) {
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const vincular = (p: Pendente) => iniciar(async () => {
    setMsg(null);
    const r = await vincularIdentificador(empresaId, p.tipo, p.identificador_hash, escolhas[p.identificador_hash] ?? '');
    setMsg(r.ok ? { tipo: 'ok', texto: r.mensagem } : { tipo: 'erro', texto: r.erro });
  });
  return (
    <div className="space-y-2">
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
      <ul className="divide-y divide-linha">
        {pendentes.map((p) => (
          <li key={p.identificador_hash} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span><span className="font-semibold">{p.tipo === 'pis' ? 'PIS' : 'CPF'} terminado em {p.final4}</span> · {Number(p.marcacoes).toLocaleString('pt-BR')} marcação(ões) · {dataBr(p.primeira.slice(0, 10))} a {dataBr(p.ultima.slice(0, 10))}</span>
            <span className="flex items-center gap-2">
              <select aria-label={`Colaborador do ${p.tipo === 'pis' ? 'PIS' : 'CPF'} terminado em ${p.final4}`} value={escolhas[p.identificador_hash] ?? ''} onChange={(e) => setEscolhas((s) => ({ ...s, [p.identificador_hash]: e.target.value }))} className={`${classeCampo} sm:w-56`}>
                <option value="">Escolha o colaborador…</option>
                {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <Botao onClick={() => vincular(p)} disabled={pendente || !escolhas[p.identificador_hash]} aria-label={`Vincular ${p.tipo === 'pis' ? 'PIS' : 'CPF'} terminado em ${p.final4}`}>Vincular</Botao>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
