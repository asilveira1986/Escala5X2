import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso, Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { ImportacaoRow } from '@/lib/tipos-db';

export default async function StatusImportacao({ params }: { params: Promise<{ id: string; importacaoId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id);
  const id = idOu404(p.importacaoId);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('importacao').select('id, status, criado_em, relatorio').eq('id', id).eq('empresa_id', empresaId).maybeSingle();
  const imp = linhas<ImportacaoRow>(data ? [data] : [])[0];
  if (!imp) notFound();
  const r = imp.relatorio;
  return (
    <Cartao titulo="Importação de colaboradores">
      {imp.status === 'processando' && (
        <>
          {/* Atualiza sozinho enquanto o worker processa */}
          <meta httpEquiv="refresh" content="3" />
          <Aviso>Processando a planilha… esta página atualiza automaticamente.</Aviso>
        </>
      )}
      {imp.status === 'aguardando_mapeamento' && <Aviso>Esta importação ainda não foi confirmada. <Link className="underline" href={`/empresas/${empresaId}/importar`}>Voltar ao assistente</Link>.</Aviso>}
      {imp.status === 'erro' && <Aviso tipo="erro">A importação falhou: {r?.mensagem ?? 'erro desconhecido'}. Nenhum dado foi gravado.</Aviso>}
      {imp.status === 'concluida' && r && (
        <div className="space-y-3">
          <Aviso tipo={r.errosTotal ? 'info' : 'ok'}>
            Concluída: {r.criados} criados, {r.atualizados} atualizados, {r.semAlteracao} sem alteração, {r.ignoradas} linhas vazias, {r.errosTotal} com erro. {r.setoresCriados ? `${r.setoresCriados} setores criados.` : ''}
          </Aviso>
          {r.errosTotal ? (
            <>
              <p className="text-sm"><a className="text-marca underline" href={`/api/v1/importacoes/${imp.id}/erros.csv`}>Baixar erros em CSV</a> (abre no Excel).</p>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr><th className="pr-3">Linha</th><th className="pr-3">Campo</th><th className="pr-3">Valor</th><th>Problema</th></tr></thead>
                  <tbody>{(r.erros ?? []).map((e, i) => <tr key={i}><td className="pr-3">{e.linha}</td><td className="pr-3">{e.campo}</td><td className="pr-3">{e.valor}</td><td>{e.mensagem}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          ) : null}
          <p className="text-sm"><Link className="text-marca underline" href={`/empresas/${empresaId}/colaboradores`}>Ver colaboradores</Link> · <Link className="text-marca underline" href={`/empresas/${empresaId}/diagnostico`}>Rodar diagnóstico</Link></p>
        </div>
      )}
    </Cartao>
  );
}
