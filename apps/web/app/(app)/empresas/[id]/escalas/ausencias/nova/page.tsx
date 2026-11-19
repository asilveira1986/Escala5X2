import { Aviso, Cartao, Titulo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { todasAsLinhas } from '@/lib/paginar';
import { FormAusencia } from '../FormAusencia';

export default async function NovaAusencia({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [col, ger] = await Promise.all([
    todasAsLinhas<{ id: string; nome: string; desligamento: string | null }>((a, b) => supabase.from('colaborador').select('id, nome, desligamento').eq('empresa_id', empresaId).order('nome').range(a, b)).then((r) => r.linhas),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const colaboradores = linhas<{ id: string; nome: string; desligamento: string | null }>(col).filter((c) => !c.desligamento).map((c) => ({ id: c.id, nome: c.nome }));
  return (
    <>
      <Titulo icone="mais" descricao="Quem está ausente não pode ser escalado: o editor bloqueia a publicação se houver trabalho nesses dias.">Lançar ausência</Titulo>
      <Cartao>{ger.data === true ? <FormAusencia empresaId={empresaId} colaboradores={colaboradores} /> : <Aviso>Só quem gere a empresa pode lançar ausências.</Aviso>}</Cartao>
    </>
  );
}
