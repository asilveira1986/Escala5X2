import Link from 'next/link';
import { Cartao, classeBotaoLinkPrimario } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { dataBr } from '@jc/rules-engine';
import { TabelaEscalas, type LinhaEscala } from './TabelaEscalas';

type EscalaBanco = { id: string; nome: string; periodo: string; status: LinhaEscala['status']; versao: number };

/** "[2027-02-01,2027-03-01)" → "01/02/2027 a 28/02/2027" */
function periodoLegivel(p: string): string {
  const m = /^[\[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})[\])]$/.exec(p);
  if (!m) return p;
  const fim = new Date(Date.parse(`${m[2]}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${dataBr(m[1]!)} a ${dataBr(fim)}`;
}

export default async function Escalas({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('escala').select('id, nome, periodo, status, versao').eq('empresa_id', empresaId).order('periodo', { ascending: false }).order('versao', { ascending: false }).limit(50);
  const escalas: LinhaEscala[] = linhas<EscalaBanco>(data).map((e) => ({ ...e, periodo: periodoLegivel(e.periodo) }));
  return (
    <Cartao icone="calendario" titulo={`${escalas.length} ${escalas.length === 1 ? 'escala' : 'escalas'}`}
      acoes={<Link href={`/empresas/${empresaId}/escalas/nova`} className={classeBotaoLinkPrimario}>Nova escala</Link>}>
      <TabelaEscalas dados={escalas} empresaId={empresaId} />
    </Cartao>
  );
}
