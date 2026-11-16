'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo, classeCampo, Selo } from '@/components/ui';
import { dataBr } from '@jc/rules-engine';
import { desfazerImportacao } from './actions';

export type ImportacaoVista = { id: string; arquivo_nome: string; status: 'processando' | 'concluida' | 'erro' | 'desfeita'; criado_em: string; relatorio: null | { dialeto?: string; inseridas?: number; marcacoesLidas?: number; periodo?: { inicio: string | null; fim: string | null }; desfeitaMotivo?: string } };
const tom = { processando: 'amarelo', concluida: 'verde', erro: 'vermelho', desfeita: 'cinza' } as const;
const rotulo = { processando: 'Processando', concluida: 'Concluída', erro: 'Com erro', desfeita: 'Desfeita' } as const;

export function ListaImportacoes({ empresaId, importacoes, podeGerir }: { empresaId: string; importacoes: ImportacaoVista[]; podeGerir: boolean }) {
  const [alvo, setAlvo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const confirmar = () => iniciar(async () => {
    if (!alvo) return;
    const r = await desfazerImportacao(empresaId, alvo, motivo);
    setMsg(r.ok ? { tipo: 'ok', texto: r.mensagem } : { tipo: 'erro', texto: r.erro });
    if (r.ok) { setAlvo(null); setMotivo(''); }
  });
  return (
    <div className="space-y-2">
      {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
      <ul className="divide-y divide-linha">
        {importacoes.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              <span className="font-semibold">{i.arquivo_nome}</span> <Selo tom={tom[i.status]}>{rotulo[i.status]}</Selo>
              <span className="block text-suave">
                {dataBr(i.criado_em.slice(0, 10))}{i.relatorio?.periodo?.inicio ? ` · marcações de ${dataBr(i.relatorio.periodo.inicio)} a ${dataBr(i.relatorio.periodo.fim ?? i.relatorio.periodo.inicio)}` : ''}
                {i.relatorio?.inseridas != null ? ` · ${i.relatorio.inseridas.toLocaleString('pt-BR')} novas` : ''}{i.relatorio?.desfeitaMotivo ? ` · desfeita: ${i.relatorio.desfeitaMotivo}` : ''}
              </span>
            </span>
            {podeGerir && i.status === 'concluida' ? <Botao variante="secundario" aria-label={`Desfazer a importação de ${i.arquivo_nome}`} onClick={() => { setAlvo(i.id); setMsg(null); }}>Desfazer</Botao> : null}
          </li>
        ))}
      </ul>
      {alvo ? (
        <div className="space-y-2 rounded-2xl bg-fundo p-3">
          <p className="text-sm">Isso remove as marcações que esta importação trouxe (as que já existiam por outra importação ficam). Fica registrado quem desfez e por quê.</p>
          <Campo rotulo="Motivo (mínimo 5 caracteres)"><input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={classeCampo} /></Campo>
          <div className="flex gap-2">
            <Botao variante="perigo" onClick={confirmar} disabled={pendente || motivo.trim().length < 5}>{pendente ? 'Desfazendo…' : 'Confirmar'}</Botao>
            <Botao variante="secundario" onClick={() => setAlvo(null)} disabled={pendente}>Voltar</Botao>
          </div>
        </div>
      ) : null}
    </div>
  );
}
