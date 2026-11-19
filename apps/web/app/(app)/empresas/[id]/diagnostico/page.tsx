import Link from 'next/link';
import { PassoAPasso } from '@/components/PassoAPasso';
import { Cartao, classeBotaoLinkPrimario } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { DiagnosticoResumoRow } from '@/lib/tipos-db';
import { data as dataBr } from '@jc/documents/formatar';
import { TabelaDiagnosticos, type LinhaDiagnostico } from './TabelaDiagnosticos';

export default async function Diagnosticos({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [{ data }, { count }] = await Promise.all([
    supabase.from('diagnostico').select('id, data_referencia, criado_em, resumo').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(20),
    supabase.from('vw_colaborador_vigente').select('colaborador_id', { count: 'exact', head: true }).eq('empresa_id', empresaId),
  ]);
  const lista = linhas<DiagnosticoResumoRow>(data);
  const { count: qtdCenarios } = lista.length > 0
    ? await supabase.from('cenario').select('id', { count: 'exact', head: true }).in('diagnostico_id', lista.map((d) => d.id))
    : { count: 0 };
  const temEquipe = (count ?? 0) > 0;
  const passos = [
    { rotulo: 'Cadastre a equipe', descricao: 'Envie a planilha com os colaboradores.', feito: temEquipe, href: `/empresas/${empresaId}/importar` },
    { rotulo: 'Rode o diagnóstico', descricao: 'Veja quem precisa mudar de escala.', feito: lista.length > 0 },
    { rotulo: 'Compare soluções', descricao: 'Simule e baixe o relatório em PDF ou planilha.', feito: (qtdCenarios ?? 0) > 0, href: lista[0] ? `/empresas/${empresaId}/diagnostico/${lista[0].id}` : undefined },
  ];
  const dados: LinhaDiagnostico[] = lista.map((d) => {
    const r = d.resumo.resumo;
    return { id: d.id, referencia: dataBr(d.data_referencia), pessoas: r ? r.total : null, aAdequar: r ? (r.porClassificacao.adequacao_f1 ?? 0) + (r.porClassificacao.adequacao_f2 ?? 0) : null, geradoEm: dataBr(d.criado_em) };
  });
  return (
    <>
      {passos.every((p) => p.feito) ? null : <PassoAPasso passos={passos} />}
      <Cartao icone="diagnostico" titulo={`${dados.length} ${dados.length === 1 ? 'diagnóstico' : 'diagnósticos'}`}
        acoes={<Link href={`/empresas/${empresaId}/diagnostico/novo`} className={classeBotaoLinkPrimario}>Novo diagnóstico</Link>}>
        <TabelaDiagnosticos dados={dados} empresaId={empresaId} />
      </Cartao>
    </>
  );
}
