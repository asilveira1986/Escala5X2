'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Aviso, Botao, Cartao, Selo } from '@/components/ui';
import { descreverMetricas, LIMITE_ACOMPANHAMENTO_MS, rotuloProposta } from '@/lib/otimizador-ui';
import { aplicarProposta, cancelarOtimizacao, gerarPropostasAutomaticas, lerOtimizacao, type EstadoOtimizacao } from '../actions';

/** Geração automática de propostas: pede, acompanha, mostra até 3 propostas e aplica a escolhida na grade. */
export function PainelOtimizador({ escalaId, inicial, bloqueado, onAplicada, intervaloMs = 2000 }: {
  escalaId: string; inicial: EstadoOtimizacao | null; bloqueado: boolean; onAplicada: () => void; intervaloMs?: number;
}) {
  const [estado, setEstado] = useState<EstadoOtimizacao | null>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState<number | null>(null);
  const [pendente, iniciar] = useTransition();
  const ativo = estado?.status === 'pendente' || estado?.status === 'processando';
  const desde = useRef(Date.now());

  useEffect(() => {
    if (!ativo || !estado) return;
    desde.current = Date.now();
    const t = setInterval(async () => {
      const novo = await lerOtimizacao(estado.id);
      if (novo) setEstado(novo);
      if (Date.now() - desde.current > LIMITE_ACOMPANHAMENTO_MS) { clearInterval(t); setErro('A geração está demorando mais que o normal. Você pode cancelar e tentar de novo.'); }
    }, intervaloMs);
    return () => clearInterval(t);
  }, [ativo, estado?.id, intervaloMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const gerar = () => iniciar(async () => {
    setErro(null);
    const r = await gerarPropostasAutomaticas(escalaId);
    if (!r.ok) { setErro(r.erro); return; }
    setEstado({ id: r.id, status: 'pendente', erro: null, resumo: null });
  });
  const cancelar = () => iniciar(async () => {
    if (!estado) return;
    await cancelarOtimizacao(estado.id);
    const novo = await lerOtimizacao(estado.id);
    setEstado(novo); setErro(null);
  });
  const aplicar = (indice: number) => iniciar(async () => {
    if (!estado) return;
    setErro(null); setAplicando(indice);
    const r = await aplicarProposta(estado.id, indice);
    setAplicando(null);
    if (!r.ok) { setErro(r.erro); return; }
    onAplicada();
  });

  const resumo = estado?.status === 'concluida' ? estado.resumo : null;
  return (
    <Cartao titulo="Propostas automáticas" subtitulo="O sistema monta até 3 escalas que respeitam a lei e cobrem a demanda. Você escolhe uma, aplica na grade e ajusta o que quiser antes de publicar.">
      <div className="flex flex-wrap items-center gap-2">
        <Botao onClick={gerar} disabled={pendente || ativo || bloqueado}>{ativo ? 'Gerando…' : resumo || estado?.status === 'erro' ? 'Gerar novamente' : 'Gerar propostas'}</Botao>
        {ativo ? <Botao variante="secundario" onClick={cancelar} disabled={pendente}>Cancelar</Botao> : null}
        {ativo ? <span role="status" className="text-sm text-suave">Isso leva até cerca de 1 minuto. Você pode continuar nesta página.</span> : null}
        {bloqueado ? <span className="text-sm text-suave">Salve as alterações da grade antes de gerar.</span> : null}
      </div>
      {erro ? <div className="mt-3"><Aviso tipo="erro">{erro}</Aviso></div> : null}
      {estado?.status === 'erro' && estado.erro && estado.erro !== 'Cancelada.' ? <div className="mt-3"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}

      {resumo?.status === 'inviavel' ? <div className="mt-3"><Aviso tipo="erro">{resumo.mensagem ?? 'Não foi possível montar uma escala com as regras atuais.'}</Aviso></div> : null}
      {resumo && resumo.status !== 'inviavel' && resumo.propostas.length === 0 ? <div className="mt-3"><Aviso tipo="erro">Nenhuma proposta passou na conferência das regras. Tente gerar novamente; se se repetir, avise o suporte.</Aviso></div> : null}
      {resumo && resumo.descartadas > 0 && resumo.propostas.length > 0 ? <p className="mt-3 text-xs text-suave">{resumo.descartadas} proposta(s) foram descartadas por não passarem na conferência das regras.</p> : null}

      {resumo && resumo.propostas.length > 0 ? (
        <ul className="mt-4 grid gap-3 lg:grid-cols-3">
          {resumo.propostas.map((p) => (
            <li key={p.indice} className="flex flex-col gap-2 rounded-2xl border border-linha bg-fundo p-3">
              <h3 className="text-sm font-bold">{rotuloProposta(p.indice, p.status)}</h3>
              <ul className="space-y-1 text-sm">
                {descreverMetricas(p.metricas, p.alertas).map((l) => (
                  <li key={l.texto} className="flex items-start gap-2"><Selo tom={l.tom === 'ok' ? 'verde' : 'amarelo'}>{l.tom === 'ok' ? 'ok' : 'atenção'}</Selo><span>{l.texto}</span></li>
                ))}
              </ul>
              <Botao className="mt-auto" variante={p.indice === 0 ? 'primario' : 'secundario'} onClick={() => aplicar(p.indice)} disabled={pendente}>
                {aplicando === p.indice ? 'Aplicando…' : 'Aplicar na grade'}
              </Botao>
            </li>
          ))}
        </ul>
      ) : null}
      {resumo && resumo.propostas.length > 0 ? <p className="mt-3 text-xs text-suave">Ao aplicar, a grade atual é substituída. Todas as propostas já foram conferidas pelas mesmas regras que validam a publicação.</p> : null}
    </Cartao>
  );
}
