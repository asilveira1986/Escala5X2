'use client';

import { useMemo, useState, useTransition } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { opcoesColega, ROTULO_TIPO, type TurnoColega } from '@/lib/solicitacoes-ui';
import { dataBr } from '@jc/rules-engine';
import { criarPedido, type NovoPedido } from './actions';

export type DiaEscala = { data: string; rotulo: string };
export type EscalaParaPedido = { id: string; nome: string; diasTrabalho: DiaEscala[]; diasFolga: DiaEscala[]; colegas: TurnoColega[] };
type Tipo = NovoPedido['tipo'];

export function FormPedido({ colaboradorId, escalas, hoje }: { colaboradorId: string; escalas: EscalaParaPedido[]; hoje: string }) {
  const [tipo, setTipo] = useState<Tipo>('troca_turno');
  const [escalaId, setEscalaId] = useState(escalas[0]?.id ?? '');
  const [meuDia, setMeuDia] = useState('');
  const [colega, setColega] = useState('');
  const [trabalharEm, setTrabalharEm] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const escala = escalas.find((e) => e.id === escalaId);
  const opcoes = useMemo(() => opcoesColega(escala?.colegas ?? []), [escala]);
  const precisaEscala = tipo === 'troca_turno' || tipo === 'troca_folga';

  const enviar = () => iniciar(async () => {
    setMsg(null);
    let pedido: NovoPedido;
    if (tipo === 'troca_turno') {
      const [destinatarioId, dataColega] = colega.split('|');
      if (!escalaId || !meuDia || !destinatarioId || !dataColega) { setMsg({ tipo: 'erro', texto: 'Escolha o seu turno e o turno do colega.' }); return; }
      pedido = { tipo, colaboradorId, escalaId, dataSolicitante: meuDia, dataColega, destinatarioId, motivo };
    } else if (tipo === 'troca_folga') {
      if (!escalaId || !meuDia || !trabalharEm) { setMsg({ tipo: 'erro', texto: 'Escolha o dia em que quer folgar e o dia em que pode trabalhar.' }); return; }
      pedido = { tipo, colaboradorId, escalaId, folgarEm: meuDia, trabalharEm, motivo };
    } else {
      if (!inicio || !fim) { setMsg({ tipo: 'erro', texto: 'Informe o primeiro e o último dia.' }); return; }
      pedido = { tipo, colaboradorId, inicio, fim, motivo };
    }
    const r = await criarPedido(pedido);
    if (!r.ok) { setMsg({ tipo: 'erro', texto: r.erro }); return; }
    setMsg({ tipo: 'ok', texto: tipo === 'troca_turno' ? 'Pedido enviado ao colega. Depois que ele aceitar, o RH decide.' : 'Pedido enviado ao RH.' });
    setMeuDia(''); setColega(''); setTrabalharEm(''); setInicio(''); setFim(''); setMotivo('');
  });

  return (
    <div className="space-y-3">
      <Campo rotulo="O que você quer pedir?">
        <select value={tipo} onChange={(e) => { setTipo(e.target.value as Tipo); setMsg(null); }} className={classeCampo}>
          {(['troca_turno', 'troca_folga', 'ferias', 'afastamento'] as const).map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
        </select>
      </Campo>
      {precisaEscala && escalas.length === 0 ? <Aviso tipo="info">Você ainda não tem escala publicada com dias futuros para trocar.</Aviso> : null}
      {precisaEscala && escalas.length > 1 ? (
        <Campo rotulo="Escala"><select value={escalaId} onChange={(e) => { setEscalaId(e.target.value); setMeuDia(''); setColega(''); setTrabalharEm(''); }} className={classeCampo}>{escalas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></Campo>
      ) : null}

      {tipo === 'troca_turno' && escala ? (
        <>
          <Campo rotulo="Seu turno que você quer passar"><select value={meuDia} onChange={(e) => setMeuDia(e.target.value)} className={classeCampo}><option value="">Escolha…</option>{escala.diasTrabalho.map((d) => <option key={d.data} value={d.data}>{d.rotulo}</option>)}</select></Campo>
          <Campo rotulo="Turno do colega que você assume" dica="Só aparecem colegas com acesso ao aplicativo. Ele precisa aceitar antes de o RH decidir."><select value={colega} onChange={(e) => setColega(e.target.value)} className={classeCampo}><option value="">Escolha…</option>{opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}</select></Campo>
        </>
      ) : null}
      {tipo === 'troca_folga' && escala ? (
        <>
          <Campo rotulo="Dia em que você quer folgar (hoje você trabalha)"><select value={meuDia} onChange={(e) => setMeuDia(e.target.value)} className={classeCampo}><option value="">Escolha…</option>{escala.diasTrabalho.map((d) => <option key={d.data} value={d.data}>{d.rotulo}</option>)}</select></Campo>
          <Campo rotulo="Dia em que você pode trabalhar no lugar (hoje é folga)"><select value={trabalharEm} onChange={(e) => setTrabalharEm(e.target.value)} className={classeCampo}><option value="">Escolha…</option>{escala.diasFolga.map((d) => <option key={d.data} value={d.data}>{d.rotulo}</option>)}</select></Campo>
        </>
      ) : null}
      {tipo === 'ferias' || tipo === 'afastamento' ? (
        <div className="flex flex-wrap gap-3">
          <Campo rotulo="Primeiro dia"><input type="date" value={inicio} min={tipo === 'ferias' ? hoje : undefined} onChange={(e) => setInicio(e.target.value)} className={classeCampo} /></Campo>
          <Campo rotulo="Último dia" dica="Inclusive."><input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} className={classeCampo} /></Campo>
        </div>
      ) : null}
      {tipo === 'afastamento' ? <p className="text-sm text-suave">Atestado: informe o período do afastamento. O RH confirma e lança.</p> : null}
      {inicio && fim && fim >= inicio && (tipo === 'ferias' || tipo === 'afastamento') ? <p className="text-sm text-suave">{dataBr(inicio)} a {dataBr(fim)}</p> : null}

      <Campo rotulo="Motivo (opcional)"><input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={classeCampo} /></Campo>
      <Botao onClick={enviar} disabled={pendente || (precisaEscala && escalas.length === 0)}>{pendente ? 'Enviando…' : 'Enviar pedido'}</Botao>
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
    </div>
  );
}
