import Link from 'next/link';
import { Aviso, Cartao, classeBotaoLinkPrimario } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { todasAsLinhas } from '@/lib/paginar';
import { lerDaterange } from '@/lib/cobertura';
import { situacaoAusencia } from '@/lib/ausencias';
import { dataBr, dataDeInstante } from '@jc/rules-engine';
import { TabelaAusencias, type LinhaAusencia } from './TabelaAusencias';

type Banco = { id: string; colaborador_id: string; periodo: string; tipo: 'ferias' | 'afastamento' };

export default async function Ausencias({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lancada?: string }> }) {
  const empresaId = idOu404((await params).id);
  const lancada = (await searchParams).lancada === '1';
  const { supabase } = await exigirUsuario();
  const [aus, col, ger] = await Promise.all([
    supabase.from('ausencia').select('id, colaborador_id, periodo, tipo').eq('empresa_id', empresaId).order('periodo', { ascending: false }).limit(300),
    todasAsLinhas<{ id: string; nome: string }>((a, b) => supabase.from('colaborador').select('id, nome').eq('empresa_id', empresaId).order('nome').range(a, b)).then((r) => r.linhas),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const nome = new Map(col.map((c) => [c.id, c.nome]));
  const hoje = dataDeInstante(new Date());
  const dados: LinhaAusencia[] = linhas<Banco>(aus.data).flatMap((a) => {
    const p = lerDaterange(a.periodo);
    return p ? [{ id: a.id, pessoa: nome.get(a.colaborador_id) ?? 'Colaborador', tipo: a.tipo, periodo: `${dataBr(p.inicio)} a ${dataBr(p.fim)}`, situacao: situacaoAusencia(p.inicio, p.fim, hoje), inicio: p.inicio }] : [];
  }).sort((a, b) => b.inicio.localeCompare(a.inicio)).map(({ inicio: _, ...l }) => l);
  const podeGerir = ger.data === true;
  return (
    <Cartao icone="ferias" titulo={`${dados.length} ${dados.length === 1 ? 'lançamento' : 'lançamentos'}`}
      subtitulo="Quem está ausente não pode ser escalado: o editor bloqueia a publicação se houver trabalho nesses dias."
      acoes={podeGerir ? <Link href={`/empresas/${empresaId}/escalas/ausencias/nova`} className={classeBotaoLinkPrimario}>Lançar ausência</Link> : undefined}>
      {lancada ? <div className="mb-3"><Aviso tipo="ok">Ausência lançada. As escalas em rascunho passam a bloquear trabalho nesse período.</Aviso></div> : null}
      <TabelaAusencias dados={dados} empresaId={empresaId} podeGerir={podeGerir} />
    </Cartao>
  );
}
