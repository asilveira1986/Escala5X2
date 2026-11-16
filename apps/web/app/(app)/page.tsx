import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { COOKIE_EMPRESA } from '@/lib/menu';

/**
 * Porta de entrada. Quem gere empresas abre direto na empresa principal (a última que usou; na primeira vez, a primeira da lista).
 * Quem só trabalha na empresa vai para a própria escala.
 */
export default async function Inicio() {
  const { supabase, user } = await exigirUsuario();
  const [{ data: gestao }, { count }] = await Promise.all([
    supabase.rpc('minhas_organizacoes_gestao'),
    supabase.from('colaborador').select('id', { count: 'exact', head: true }).eq('usuario_id', user.id),
  ]);
  const temGestao = Array.isArray(gestao) && gestao.length > 0;
  if (!temGestao) redirect((count ?? 0) > 0 ? '/minha-escala' : '/empresas');
  const { data } = await supabase.from('empresa').select('id').order('razao_social').limit(300);
  const ids = linhas<{ id: string }>(data).map((e) => e.id);
  const lembrada = (await cookies()).get(COOKIE_EMPRESA)?.value?.toLowerCase();
  const principal = (lembrada && ids.includes(lembrada) ? lembrada : ids[0]);
  redirect(principal ? `/empresas/${principal}` : '/empresas');
}
