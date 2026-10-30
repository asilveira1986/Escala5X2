'use client';

import { useState, useTransition } from 'react';
import { CAMPOS_COLABORADOR, type Mapeamento } from '@jc/connectors/mapeamento'; // subcaminho leve: sem exceljs no navegador
import { Aviso, Botao, Cartao, classeCampo } from '@/components/ui';
import { IconeEnviar } from '@/components/icones';
import { supabaseNavegador } from '@/lib/supabase/client';
import { analisarArquivo, confirmarImportacao, prepararEnvio, validarImportacao, type RespostaEnvio, type RespostaValidacao } from './actions';

const ETAPAS = ['Enviar planilha', 'Conferir colunas', 'Confirmar'];

function Etapas({ atual }: { atual: number }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Etapas da importação">
      {ETAPAS.map((rotulo, i) => (
        <li key={rotulo} aria-current={i + 1 === atual ? 'step' : undefined}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${i + 1 === atual ? 'bg-marca text-sobre-marca' : i + 1 < atual ? 'bg-marca-suave text-marca' : 'bg-neutro-bg text-neutro-fg'}`}>
          <span className="grid size-5 place-items-center rounded-full bg-cartao/25 text-xs">{i + 1}</span>{rotulo}
        </li>
      ))}
    </ol>
  );
}

export function AssistenteImportacao({ empresaId }: { empresaId: string }) {
  const [envio, setEnvio] = useState<RespostaEnvio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mapa, setMapa] = useState<Mapeamento | null>(null);
  const [validacao, setValidacao] = useState<RespostaValidacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const atual = envio?.ok ? envio : null;

  // O navegador envia direto ao Storage (URL assinada); o servidor só autoriza e depois lê o arquivo.
  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const arquivo = new FormData(e.currentTarget).get('arquivo');
    if (!(arquivo instanceof File) || arquivo.size === 0) return setEnvio({ ok: false, erro: 'Selecione um arquivo .csv ou .xlsx.' });
    setEnviando(true);
    try {
      const prep = await prepararEnvio(empresaId, arquivo.name.split('.').pop() ?? '', arquivo.size);
      if (!prep.ok) return setEnvio(prep);
      const up = await supabaseNavegador().storage.from('importacoes').uploadToSignedUrl(prep.caminho, prep.token, arquivo);
      if (up.error) return setEnvio({ ok: false, erro: 'Falha ao enviar o arquivo. Tente novamente.' });
      const r = await analisarArquivo(empresaId, prep.caminho);
      if (r.ok) setMapa(r.sugestao);
      setEnvio(r);
    } catch {
      setEnvio({ ok: false, erro: 'Falha de conexão ao enviar o arquivo.' });
    } finally {
      setEnviando(false);
    }
  }

  if (!atual) {
    return (
      <div className="space-y-4">
      <Etapas atual={1} />
      <Cartao titulo="Envie a planilha da equipe" subtitulo="Aceitamos arquivos .csv e .xlsx de até 10 MB, com os nomes das colunas na primeira linha. Nada é salvo antes da sua confirmação.">
        <form onSubmit={enviar} className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-linha bg-fundo px-4 py-8 text-center hover:border-marca">
            <span className="grid size-12 place-items-center rounded-full bg-marca-suave text-marca"><IconeEnviar width={24} height={24} /></span>
            <span className="font-semibold">Escolha o arquivo no seu computador</span>
            <span className="text-xs text-suave">Planilha do Excel (.xlsx) ou arquivo separado por vírgula (.csv)</span>
            <input id="arquivo" type="file" name="arquivo" accept=".csv,.xlsx" required className="mt-2 max-w-full text-sm" />
          </label>
          {envio && !envio.ok ? <Aviso tipo="erro">{envio.erro}</Aviso> : null}
          <Botao disabled={enviando}>{enviando ? 'Lendo arquivo…' : 'Enviar e continuar'}</Botao>
        </form>
      </Cartao>
      </div>
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
      <Etapas atual={validacao?.ok ? 3 : 2} />
      <Cartao titulo="Confira as colunas" subtitulo="Já tentamos encaixar cada coluna da sua planilha. Ajuste o que estiver errado; os campos com * são obrigatórios.">
        <p className="mb-4 text-sm font-semibold">{atual.totalLinhas} linhas encontradas.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAMPOS_COLABORADOR.map((c) => (
            <label key={c.chave} className="block text-sm font-semibold">{c.rotulo}{c.obrigatorio ? ' *' : ''}
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

      <Cartao titulo="Valide e confirme" subtitulo="A validação só confere os dados. Quando estiver tudo certo, importe.">
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
