import Link from 'next/link';
import { Cartao, classeBotaoLinkPrimario } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { TabelaTurnos, type LinhaTurno } from './TabelaTurnos';

export default async function Turnos({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('turno_modelo').select('id, nome, inicio_min, fim_min, intervalo_min').eq('empresa_id', empresaId).eq('ativo', true).order('inicio_min');
  const turnos = linhas<LinhaTurno>(data);
  return (
    <Cartao icone="turnos" titulo={`${turnos.length} ${turnos.length === 1 ? 'turno' : 'turnos'}`}
      acoes={<Link href={`/empresas/${empresaId}/escalas/turnos/novo`} className={classeBotaoLinkPrimario}>Novo turno</Link>}>
      <TabelaTurnos dados={turnos} empresaId={empresaId} />
    </Cartao>
  );
}
