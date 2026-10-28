import Link from 'next/link';
import { Aviso, Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { ColaboradorVigenteRow } from '@/lib/tipos-db';
import { TabelaColaboradores } from './TabelaColaboradores';

const LIMITE = 5000;

export default async function Colaboradores({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.from('vw_colaborador_vigente')
    .select('colaborador_id, nome, matricula, cargo, setor_nome, turno, salario_base, jornada_semanal_min, divisor, tipo_escala, hipersuficiente')
    .eq('empresa_id', empresaId).order('nome').limit(LIMITE);
  const dados = linhas<ColaboradorVigenteRow>(data);
  return (
    <Cartao titulo={`Colaboradores (${dados.length})`}>
      {error ? <Aviso tipo="erro">Não foi possível carregar os colaboradores.</Aviso> : null}
      {dados.length >= LIMITE ? <Aviso>Exibindo os primeiros {LIMITE} colaboradores.</Aviso> : null}
      <div className="mb-3 text-sm"><Link className="text-blue-800 hover:underline dark:text-blue-300" href={`/empresas/${empresaId}/importar`}>Importar ou atualizar por planilha</Link></div>
      <TabelaColaboradores dados={dados} />
    </Cartao>
  );
}
