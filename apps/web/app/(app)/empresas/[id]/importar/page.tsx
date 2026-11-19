import { Abas } from '@/components/Abas';
import { Cartao } from '@/components/ui';
import { lerAba } from '@/lib/abas';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { resultadoImportacao } from '@/lib/importacao-ui';
import type { ImportacaoRow } from '@/lib/tipos-db';
import { data as dataBr } from '@jc/documents/formatar';
import { AssistenteImportacao } from './AssistenteImportacao';
import { TabelaImportacoes, type LinhaImportacao } from './TabelaImportacoes';

const ABAS = [{ id: 'nova', rotulo: 'Nova importação' }, { id: 'historico', rotulo: 'Importações' }];

export default async function Importar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const empresaId = idOu404((await params).id);
  const aba = lerAba((await searchParams).aba, ABAS);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('importacao').select('id, status, criado_em, relatorio').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(30);
  const dados: LinhaImportacao[] = linhas<ImportacaoRow>(data).map((h) => ({ id: h.id, data: dataBr(h.criado_em), status: h.status, resultado: resultadoImportacao(h.status, h.relatorio) }));
  return (
    <>
      <Abas abas={ABAS.map((a) => (a.id === 'historico' ? { ...a, contagem: dados.length } : a))} atual={aba} base={`/empresas/${empresaId}/importar`} rotulo="Seções da importação" />
      {aba === 'nova' ? <AssistenteImportacao empresaId={empresaId} /> : (
        <Cartao icone="importar" titulo={`${dados.length} ${dados.length === 1 ? 'importação' : 'importações'}`} subtitulo="As últimas planilhas enviadas e o resultado de cada uma.">
          <TabelaImportacoes dados={dados} empresaId={empresaId} />
        </Cartao>
      )}
    </>
  );
}
