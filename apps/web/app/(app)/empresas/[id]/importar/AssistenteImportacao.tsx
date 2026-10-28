'use client';

import { useActionState, useState, useTransition } from 'react';
import { CAMPOS_COLABORADOR, type Mapeamento } from '@jc/connectors/mapeamento'; // subcaminho leve: sem exceljs no navegador
import { Aviso, Botao, Cartao, classeCampo } from '@/components/ui';
import { confirmarImportacao, enviarPlanilha, validarImportacao, type RespostaEnvio, type RespostaValidacao } from './actions';

export function AssistenteImportacao({ empresaId }: { empresaId: string }) {
  const [envio, enviar, enviando] = useActionState<RespostaEnvio | null, FormData>(enviarPlanilha, null);
  const [mapa, setMapa] = useState<Mapeamento | null>(null);
  const [validacao, setValidacao] = useState<RespostaValidacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  // Quando um envio novo chega, adota a sugestão de mapeamento.
  const atual = envio?.ok ? envio : null;
  if (atual && mapa === null) setMapa(atual.sugestao);

  if (!atual) {
    return (
      <Cartao titulo="1. Envie a planilha">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Aceitamos .csv (UTF-8 ou Windows-1252) e .xlsx de até 10 MB, com cabeçalho na primeira linha. Nada é gravado antes da sua confirmação.</p>
        <form action={enviar} className="space-y-3">
          <input type="hidden" name="empresaId" value={empresaId} />
          <label className="block text-sm font-medium">Arquivo
            <input type="file" name="arquivo" accept=".csv,.xlsx" required className={classeCampo} />
          </label>
          {envio && !envio.ok ? <Aviso tipo="erro">{envio.erro}</Aviso> : null}
          <Botao disabled={enviando}>{enviando ? 'Lendo arquivo…' : 'Enviar e continuar'}</Botao>
        </form>
      </Cartao>
    );
  }

  const m = mapa ?? atual.sugestao;
  const validar = () => iniciar(async () => { setErro(null); setValidacao(await validarImportacao(atual.importacaoId, m)); });
  const confirmar = () => iniciar(async () => {
    setErro(null);
    const r = await confirmarImportacao(atual.importacaoId, m);
    if (r?.erro) setErro(r.erro);
  });
  const podeConfirmar = validacao?.ok === true && validacao.faltando.length === 0 && validacao.validas > 0;

  return (
    <div className="space-y-4">
      <Cartao titulo="2. Mapeie as colunas">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{atual.totalLinhas} linhas encontradas. Confira a sugestão automática e ajuste se necessário. Campos com * são obrigatórios.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAMPOS_COLABORADOR.map((c) => (
            <label key={c.chave} className="block text-sm font-medium">{c.rotulo}{c.obrigatorio ? ' *' : ''}
              <select className={classeCampo} value={m[c.chave] ?? ''} onChange={(e) => { setMapa({ ...m, [c.chave]: e.target.value || null }); setValidacao(null); }}>
                <option value="">— não importar —</option>
                {atual.colunas.map((col) => <option key={col} value={col}>{col}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="mb-1 text-left text-sm font-medium">Prévia (5 primeiras linhas)</caption>
            <thead><tr>{atual.colunas.map((c) => <th key={c} className="pr-3">{c}</th>)}</tr></thead>
            <tbody>{atual.previa.map((l, i) => <tr key={i}>{l.map((v, j) => <td key={j} className="pr-3">{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Cartao>

      <Cartao titulo="3. Valide e confirme">
        <div className="flex flex-wrap gap-2">
          <Botao variante="secundario" onClick={validar} disabled={pendente}>{pendente ? 'Validando…' : 'Validar planilha'}</Botao>
          <Botao onClick={confirmar} disabled={pendente || !podeConfirmar}>Importar colaboradores válidos</Botao>
        </div>
        {erro ? <div className="mt-3"><Aviso tipo="erro">{erro}</Aviso></div> : null}
        {validacao && !validacao.ok ? <div className="mt-3"><Aviso tipo="erro">{validacao.erro}</Aviso></div> : null}
        {validacao?.ok ? (
          <div className="mt-3 space-y-2">
            {validacao.faltando.length > 0 ? <Aviso tipo="erro">Mapeie as colunas obrigatórias: {validacao.faltando.join(', ')}.</Aviso> : null}
            <Aviso tipo={validacao.errosTotal === 0 ? 'ok' : 'info'}>
              {validacao.validas} linhas válidas · {validacao.errosTotal} com erro · {validacao.ignoradas} vazias ignoradas · {validacao.avisosTotal} avisos.
              {validacao.errosTotal > 0 ? ' As linhas com erro não serão importadas; corrija e reenvie depois, se desejar.' : ''}
            </Aviso>
            {validacao.erros.length > 0 && (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr><th className="pr-3">Linha</th><th className="pr-3">Campo</th><th className="pr-3">Valor</th><th>Problema</th></tr></thead>
                  <tbody>{validacao.erros.map((e, i) => <tr key={i}><td className="pr-3">{e.linha}</td><td className="pr-3">{e.campo}</td><td className="pr-3">{e.valor}</td><td>{e.mensagem}</td></tr>)}</tbody>
                </table>
                {validacao.errosTotal > validacao.erros.length ? <p className="mt-1 text-xs">Mostrando {validacao.erros.length} de {validacao.errosTotal} erros.</p> : null}
              </div>
            )}
          </div>
        ) : null}
      </Cartao>
    </div>
  );
}
