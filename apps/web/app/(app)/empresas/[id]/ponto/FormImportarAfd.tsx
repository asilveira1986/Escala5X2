'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';

type Erro = { linha: number; mensagem: string; trecho: string };
type Relatorio = { dialeto: string; marcacoesLidas: number; inseridas: number; jaExistiam: number; periodo: { inicio: string | null; fim: string | null }; naoReconhecidos: number; errosTotal: number; avisos: string[] };
const ROTULO_DIALETO: Record<string, string> = { portaria_1510: 'Portaria 1.510 (PIS)', portaria_671: 'Portaria 671 (CPF)' };

export function FormImportarAfd({ empresaId }: { empresaId: string }) {
  const router = useRouter();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [parcial, setParcial] = useState(false);
  const [falha, setFalha] = useState<{ erro: string; erros: Erro[]; avisos: string[]; podeParcial: boolean } | null>(null);
  const [ok, setOk] = useState<Relatorio | null>(null);
  const [pendente, iniciar] = useTransition();

  const enviar = () => iniciar(async () => {
    if (!arquivo) return;
    setFalha(null); setOk(null);
    const f = new FormData();
    f.set('empresaId', empresaId); f.set('arquivo', arquivo); f.set('parcial', parcial ? '1' : '0');
    try {
      const r = await fetch('/api/v1/ponto/importar', { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) { setFalha({ erro: j.erro ?? 'Não foi possível importar.', erros: j.erros ?? [], avisos: j.avisos ?? [], podeParcial: !!j.podeParcial }); return; }
      setOk(j as Relatorio); setArquivo(null); router.refresh();
    } catch { setFalha({ erro: 'Sem conexão com o servidor. Tente novamente.', erros: [], avisos: [], podeParcial: false }); }
  });

  return (
    <div className="space-y-3">
      <Campo rotulo="Arquivo AFD (.txt)" dica="Gerado pelo relógio de ponto (REP) ou pelo sistema de ponto. Até 10 MB; para períodos longos, gere em partes.">
        <input type="file" accept=".txt,.afd,text/plain" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setFalha(null); setOk(null); }} className={classeCampo} />
      </Campo>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={parcial} onChange={(e) => setParcial(e.target.checked)} className="mt-0.5 size-5" />Importar mesmo que algumas linhas estejam fora do leiaute (as linhas com problema ficam de fora e são listadas).</label>
      <Botao onClick={enviar} disabled={pendente || !arquivo}>{pendente ? 'Importando…' : 'Importar AFD'}</Botao>

      {falha ? (
        <div className="space-y-2">
          <Aviso tipo="erro">{falha.erro}</Aviso>
          {falha.avisos.map((a, i) => <Aviso key={i} tipo="info">{a}</Aviso>)}
          {falha.erros.length > 0 ? (
            <details open className="rounded-2xl border border-linha bg-fundo p-3 text-sm">
              <summary className="cursor-pointer font-semibold">Linhas com problema (primeiras {falha.erros.length})</summary>
              <ul className="mt-2 space-y-0.5">{falha.erros.map((e, i) => <li key={i}>Linha {e.linha}: {e.mensagem}</li>)}</ul>
            </details>
          ) : null}
          {falha.podeParcial && !parcial ? <p className="text-sm text-suave">Para importar só o que está válido, marque a opção acima e envie de novo.</p> : null}
        </div>
      ) : null}
      {ok ? (
        <div className="space-y-2">
          <Aviso tipo="ok">Importado: {ok.inseridas.toLocaleString('pt-BR')} marcação(ões) nova(s){ok.jaExistiam > 0 ? `, ${ok.jaExistiam.toLocaleString('pt-BR')} já existiam` : ''}. Leiaute {ROTULO_DIALETO[ok.dialeto] ?? ok.dialeto}.</Aviso>
          {ok.naoReconhecidos > 0 ? <Aviso tipo="info">{ok.naoReconhecidos} identificador(es) ainda não reconhecidos: vincule-os a um colaborador abaixo.</Aviso> : null}
          {ok.avisos.map((a, i) => <Aviso key={i} tipo="info">{a}</Aviso>)}
          {ok.errosTotal > 0 ? <Aviso tipo="info">{ok.errosTotal} linha(s) foram ignoradas por estarem fora do leiaute.</Aviso> : null}
        </div>
      ) : null}
    </div>
  );
}
