'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao, classeCampo, Selo } from '@/components/ui';
import { convidar, revogarAcesso } from './actions';

export type Acesso = { estado: 'sem' | 'pendente' | 'com'; email?: string };

export function CelulaAcesso({ empresaId, colaboradorId, nome, acesso, podeGerir }: { empresaId: string; colaboradorId: string; nome: string; acesso: Acesso; podeGerir: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState(acesso.email ?? '');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  const enviar = () => iniciar(async () => {
    const r = await convidar(empresaId, colaboradorId, email);
    setMsg(r.ok ? { tipo: 'ok', texto: r.mensagem } : { tipo: 'erro', texto: r.erro });
    if (r.ok) setAberto(false);
  });
  const revogar = () => iniciar(async () => {
    if (!window.confirm(`Remover o acesso de ${nome}? A pessoa deixa de ver a escala.`)) return;
    const r = await revogarAcesso(empresaId, colaboradorId);
    setMsg(r.ok ? { tipo: 'ok', texto: r.mensagem } : { tipo: 'erro', texto: r.erro });
  });

  return (
    <div className="min-w-44 space-y-1.5">
      {acesso.estado === 'com' ? <Selo tom="verde">Com acesso</Selo> : acesso.estado === 'pendente' ? <Selo tom="amarelo">Convite enviado</Selo> : <Selo tom="cinza">Sem acesso</Selo>}
      {acesso.estado === 'pendente' && acesso.email ? <p className="text-xs text-suave">{acesso.email}</p> : null}
      {podeGerir && !aberto ? (
        <div className="flex gap-1.5">
          {acesso.estado !== 'com' ? <Botao variante="secundario" onClick={() => { setAberto(true); setMsg(null); }} disabled={pendente} aria-label={`${acesso.estado === 'pendente' ? 'Reenviar convite' : 'Convidar'} ${nome}`}>{acesso.estado === 'pendente' ? 'Reenviar' : 'Convidar'}</Botao> : null}
          {acesso.estado !== 'sem' ? <Botao variante="secundario" onClick={revogar} disabled={pendente} aria-label={`${acesso.estado === 'com' ? 'Remover acesso' : 'Cancelar convite'} de ${nome}`}>{acesso.estado === 'com' ? 'Remover' : 'Cancelar'}</Botao> : null}
        </div>
      ) : null}
      {aberto ? (
        <div className="space-y-1.5">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e-mail da pessoa" aria-label={`E-mail de ${nome}`} className={classeCampo} />
          <div className="flex gap-1.5">
            <Botao onClick={enviar} disabled={pendente || !email}>{pendente ? 'Enviando…' : 'Enviar convite'}</Botao>
            <Botao variante="secundario" onClick={() => setAberto(false)} disabled={pendente}>Cancelar</Botao>
          </div>
        </div>
      ) : null}
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
    </div>
  );
}
