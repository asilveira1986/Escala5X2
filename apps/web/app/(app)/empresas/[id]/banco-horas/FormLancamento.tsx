'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { duracaoParaCampo, TIPOS_LANCAMENTO } from '@/lib/banco-horas-ui';
import { lancar } from './actions';

export function FormLancamento({ empresaId, colaboradorId, hoje, vencidoMin }: { empresaId: string; colaboradorId: string; hoje: string; vencidoMin: number }) {
  const [idx, setIdx] = useState(0);
  const [data, setData] = useState(hoje);
  const [duracao, setDuracao] = useState('');
  const [descricao, setDescricao] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const t = TIPOS_LANCAMENTO[idx]!;

  const escolher = (i: number) => {
    setIdx(i);
    if (TIPOS_LANCAMENTO[i]!.id === 'pagamento' && vencidoMin > 0) setDuracao(duracaoParaCampo(Math.min(vencidoMin, 1440)));   // sugere quitar o vencido
  };
  const enviar = () => iniciar(async () => {
    setMsg(null);
    const r = await lancar({ empresaId, colaboradorId, tipo: t.id, sinal: t.sinal, data, duracao, descricao });
    if (!r.ok) { setMsg({ tipo: 'erro', texto: r.erro }); return; }
    setMsg({ tipo: 'ok', texto: r.mensagem }); setDuracao(''); setDescricao('');
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Tipo"><select value={idx} onChange={(e) => escolher(Number(e.target.value))} className={`${classeCampo} sm:w-72`}>{TIPOS_LANCAMENTO.map((x, i) => <option key={i} value={i}>{x.rotulo}</option>)}</select></Campo>
        <Campo rotulo="Data"><input type="date" value={data} onChange={(e) => setData(e.target.value)} className={classeCampo} /></Campo>
        <Campo rotulo="Duração" dica="Horas:minutos, ex.: 02:30."><input value={duracao} onChange={(e) => setDuracao(e.target.value)} placeholder="02:30" inputMode="numeric" className={`${classeCampo} sm:w-28`} /></Campo>
        <Campo rotulo="Descrição (opcional)"><input value={descricao} maxLength={300} onChange={(e) => setDescricao(e.target.value)} className={`${classeCampo} sm:w-64`} /></Campo>
        <Botao onClick={enviar} disabled={pendente}>{pendente ? 'Salvando…' : 'Lançar'}</Botao>
      </div>
      {t.id === 'pagamento' && vencidoMin === 0 ? <p className="text-sm text-suave">Não há horas vencidas a pagar.</p> : null}
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
    </div>
  );
}
