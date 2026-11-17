'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Aviso, Botao } from '@/components/ui';
import { saldoTexto } from '@/lib/banco-horas-ui';
import { dataBr } from '@jc/rules-engine';
import { lancarApuracao, type ResultadoApuracao } from './actions';

export type LinhaApuracao = { colaboradorId: string; nome: string; data: string; minutos: number; previstoMin: number; efetivoMin: number; motivo: string; jaLancado: boolean };
const chave = (l: Pick<LinhaApuracao, 'colaboradorId' | 'data'>) => `${l.colaboradorId}|${l.data}`;

export function ListaApuracao({ empresaId, mes, linhas, podeGerir }: { empresaId: string; mes: string; linhas: LinhaApuracao[]; podeGerir: boolean }) {
  const router = useRouter();
  const disponiveis = useMemo(() => linhas.filter((l) => !l.jaLancado), [linhas]);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(disponiveis.map(chave)));
  const [resultado, setResultado] = useState<ResultadoApuracao | null>(null);
  const [pendente, iniciar] = useTransition();
  const alternar = (k: string) => setMarcados((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const todos = disponiveis.length > 0 && disponiveis.every((l) => marcados.has(chave(l)));
  const sel = disponiveis.filter((l) => marcados.has(chave(l)));
  const creditos = sel.filter((l) => l.minutos > 0).reduce((t, l) => t + l.minutos, 0), debitos = sel.filter((l) => l.minutos < 0).reduce((t, l) => t + l.minutos, 0);
  const nomes = new Map(linhas.map((l) => [l.colaboradorId, l.nome]));

  const lancar = () => iniciar(async () => {
    const r = await lancarApuracao(empresaId, mes, sel.map((l) => ({ colaboradorId: l.colaboradorId, data: l.data })));
    setResultado(r);
    if (r.ok) router.refresh();
  });

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs font-semibold uppercase tracking-wide text-suave">
            <tr>
              <th className="w-8 py-1.5 pr-2">{podeGerir && disponiveis.length > 0 ? <input type="checkbox" aria-label="Marcar todos" className="size-4" checked={todos} onChange={() => setMarcados(todos ? new Set() : new Set(disponiveis.map(chave)))} /> : null}</th>
              <th className="pr-3">Colaborador</th><th className="pr-3">Dia</th><th className="pr-3 text-right">Previsto</th><th className="pr-3 text-right">Trabalhado</th><th className="pr-3 text-right">Saldo do dia</th><th>O que aconteceu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linha">
            {linhas.map((l) => (
              <tr key={chave(l)} className={l.jaLancado ? 'text-suave' : ''}>
                <td className="py-1.5 pr-2">{podeGerir && !l.jaLancado ? <input type="checkbox" className="size-4" aria-label={`Lançar ${l.nome} em ${dataBr(l.data)}`} checked={marcados.has(chave(l))} onChange={() => alternar(chave(l))} /> : null}</td>
                <td className="pr-3 font-semibold">{l.nome}</td>
                <td className="pr-3">{dataBr(l.data)}</td>
                <td className="pr-3 text-right">{Math.floor(l.previstoMin / 60)}h{String(l.previstoMin % 60).padStart(2, '0')}</td>
                <td className="pr-3 text-right">{Math.floor(l.efetivoMin / 60)}h{String(l.efetivoMin % 60).padStart(2, '0')}</td>
                <td className={`pr-3 text-right font-semibold ${l.minutos < 0 ? 'text-risco-fg' : 'text-ok-fg'}`}>{saldoTexto(l.minutos)}</td>
                <td>{l.jaLancado ? <span className="rounded-full bg-neutro-bg px-2 py-0.5 text-xs font-semibold text-neutro-fg">já lançado</span> : l.motivo.replace(/ \([+−]\d+h\d+\)$/, '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {podeGerir ? (
        <div className="flex flex-wrap items-center gap-3">
          <Botao onClick={lancar} disabled={pendente || sel.length === 0}>{pendente ? 'Lançando…' : `Lançar ${sel.length} dia${sel.length === 1 ? '' : 's'} no banco de horas`}</Botao>
          <span className="text-sm text-suave">{sel.length > 0 ? `Créditos ${saldoTexto(creditos)} · débitos ${saldoTexto(debitos)}` : 'Nada marcado.'}</span>
        </div>
      ) : <p className="text-sm text-suave">Só quem gere a empresa pode lançar no banco de horas.</p>}
      {resultado && resultado.ok ? (
        <div className="space-y-2">
          <Aviso tipo={resultado.recusados.length > 0 ? 'info' : 'ok'}>{resultado.lancados} dia(s) lançado(s) no banco de horas{resultado.recusados.length > 0 ? `; ${resultado.recusados.length} não puderam ser lançados:` : '.'}</Aviso>
          {resultado.recusados.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {resultado.recusados.map((r) => <li key={`${r.colaboradorId}|${r.data}`} className="rounded-xl bg-atencao-bg px-3 py-1.5 text-atencao-fg"><strong>{nomes.get(r.colaboradorId) ?? 'Colaborador'}</strong> · {dataBr(r.data)} — {r.motivo}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {resultado && !resultado.ok ? <Aviso tipo="erro">{resultado.erro}</Aviso> : null}
    </div>
  );
}
