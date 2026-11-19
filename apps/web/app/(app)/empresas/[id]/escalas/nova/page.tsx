import Link from 'next/link';
import { Aviso, Cartao, Titulo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { dataDeInstante } from '@jc/rules-engine';
import { FormNovaEscala } from '../FormNovaEscala';

export default async function NovaEscala({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [mod, set] = await Promise.all([
    supabase.from('turno_modelo').select('id').eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome'),
  ]);
  const semTurnos = linhas<{ id: string }>(mod.data).length === 0;
  const setores = linhas<{ id: string; nome: string }>(set.data).map((s) => ({ id: s.id, nome: s.nome }));
  return (
    <>
      <Titulo icone="mais" descricao="Monte o mês à mão: veja os avisos da lei na hora e publique quando estiver tudo certo.">Nova escala</Titulo>
      <Cartao>
        {semTurnos ? <div className="mb-3"><Aviso tipo="info">Cadastre pelo menos um turno para poder montar a escala. <Link className="underline" href={`/empresas/${empresaId}/escalas/turnos/novo`}>Cadastrar turno</Link></Aviso></div> : null}
        <FormNovaEscala empresaId={empresaId} mesPadrao={dataDeInstante(new Date()).slice(0, 7)} setores={setores} />
      </Cartao>
    </>
  );
}
