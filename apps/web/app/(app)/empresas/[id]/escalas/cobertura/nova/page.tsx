import { Aviso, Cartao, Titulo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { FormDemanda } from '../FormDemanda';

export default async function NovaFaixa({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [set, ger] = await Promise.all([
    supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome'),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const setores = linhas<{ id: string; nome: string }>(set.data).map((s) => ({ id: s.id, nome: s.nome }));
  return (
    <>
      <Titulo icone="mais" descricao="Quantas pessoas precisam estar trabalhando em uma faixa de horário. Faixa de um setor vale só para escalas desse setor.">Nova faixa de cobertura</Titulo>
      <Cartao>{ger.data === true ? <FormDemanda empresaId={empresaId} setores={setores} /> : <Aviso>Só quem gere a empresa pode alterar a cobertura.</Aviso>}</Cartao>
    </>
  );
}
