import Link from 'next/link';
import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { Aviso, Cartao, classeBotaoLink, Selo } from '@/components/ui';
import { ROTULO_IMPORTACAO, TOM_IMPORTACAO } from '@/lib/importacao-ui';
import type { ImportacaoRow } from '@/lib/tipos-db';
import { data as dataBr } from '@jc/documents/formatar';

/** Tela de uma importação: cabeçalho com a situação, resumo do resultado, erros por linha e os próximos passos. */
export function TelaImportacao({ empresaId, importacao: imp }: { empresaId: string; importacao: Pick<ImportacaoRow, 'id' | 'status' | 'criado_em' | 'relatorio'> }) {
  const r = imp.relatorio;
  const subtitulo = [r?.totalLinhas ? `${r.totalLinhas} linhas na planilha` : null, r?.setoresCriados ? `${r.setoresCriados} ${r.setoresCriados === 1 ? 'setor criado' : 'setores criados'}` : null].filter(Boolean).join(' · ');
  return (
    <>
      {imp.status === 'processando' ? <meta httpEquiv="refresh" content="3" /> : null}   {/* atualiza sozinho enquanto o worker processa */}
      <CabecalhoItem icone="importar" titulo={`Importação de ${dataBr(imp.criado_em)}`} subtitulo={subtitulo || undefined} selo={<Selo tom={TOM_IMPORTACAO[imp.status]}>{ROTULO_IMPORTACAO[imp.status]}</Selo>} />

      {imp.status === 'processando' ? <Aviso>Processando a planilha… esta página atualiza automaticamente.</Aviso> : null}
      {imp.status === 'aguardando_mapeamento' ? <Aviso>Esta importação ainda não foi confirmada. <Link className="underline" href={`/empresas/${empresaId}/importar`}>Voltar ao assistente</Link>.</Aviso> : null}
      {imp.status === 'erro' ? <Aviso tipo="erro">A importação falhou: {r?.mensagem ?? 'erro desconhecido'}. Nenhum dado foi gravado.</Aviso> : null}

      {imp.status === 'concluida' && r ? (
        <>
          <ResumoItem rotulo="Resultado da importação" itens={[
            { rotulo: 'Criados', valor: <span className="horario">{r.criados ?? 0}</span> },
            { rotulo: 'Atualizados', valor: <span className="horario">{r.atualizados ?? 0}</span> },
            { rotulo: 'Sem alteração', valor: <span className="horario">{r.semAlteracao ?? 0}</span> },
            { rotulo: 'Com erro', valor: <span className={`horario ${r.errosTotal ? 'text-risco-fg' : ''}`}>{r.errosTotal ?? 0}</span> },
          ]} />
          {r.errosTotal ? (
            <Cartao icone="importar" titulo="Linhas com erro" subtitulo="Estas linhas não foram importadas. Corrija na planilha e envie de novo, se quiser."
              acoes={<a className={classeBotaoLink} href={`/api/v1/importacoes/${imp.id}/erros.csv`}>Baixar erros em CSV</a>}>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="rotulo-col"><tr><th className="py-1.5 pr-3">Linha</th><th className="pr-3">Campo</th><th className="pr-3">Valor</th><th>Problema</th></tr></thead>
                  <tbody className="divide-y divide-linha">{(r.erros ?? []).map((e, i) => <tr key={i}><td className="horario py-1.5 pr-3">{e.linha}</td><td className="pr-3">{e.campo}</td><td className="pr-3">{e.valor}</td><td>{e.mensagem}</td></tr>)}</tbody>
                </table>
              </div>
              {r.errosTotal > (r.erros?.length ?? 0) ? <p className="mt-2 text-xs text-suave">Mostrando {r.erros?.length ?? 0} de {r.errosTotal} erros; o CSV traz todos.</p> : null}
            </Cartao>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link className={classeBotaoLink} href={`/empresas/${empresaId}/colaboradores`}>Ver colaboradores</Link>
            <Link className={classeBotaoLink} href={`/empresas/${empresaId}/diagnostico`}>Rodar diagnóstico</Link>
          </div>
        </>
      ) : null}
    </>
  );
}
