import { redirect } from 'next/navigation';
import { exigirUsuario } from '@/lib/contexto';

/** Quem só trabalha na empresa (sem papel de gestão) vai direto para a própria escala. */
export default async function Inicio() {
  const { supabase, user } = await exigirUsuario();
  const [{ data: gestao }, { count }] = await Promise.all([
    supabase.rpc('minhas_organizacoes_gestao'),
    supabase.from('colaborador').select('id', { count: 'exact', head: true }).eq('usuario_id', user.id),
  ]);
  const temGestao = Array.isArray(gestao) && gestao.length > 0;
  redirect(!temGestao && (count ?? 0) > 0 ? '/minha-escala' : '/empresas');
}
