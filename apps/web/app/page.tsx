import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';

export default async function Inicio() {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: orgs } = await supabase.from('organizacao').select('id, nome, tipo');
  return (
    <>
      <h1>JornadaCerta</h1>
      <p>Olá, {user.email}.</p>
      <ul>{(orgs ?? []).map((o) => <li key={o.id}>{o.nome} ({o.tipo})</li>)}</ul>
      <form action="/auth/sair" method="post"><button type="submit">Sair</button></form>
    </>
  );
}
