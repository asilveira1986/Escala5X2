import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Casca } from '@/components/Casca';
import { PwaRegistro } from '@/components/PwaRegistro';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { COOKIE_MENU, lerEstadoMenu } from '@/lib/menu';
import { hashUsuario } from '@/lib/pwa/uid';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, user } = await exigirUsuario();
  // Aviso visível enquanto o MFA estiver desligado (erro na consulta = considera ligado, sem aviso falso).
  const { data: mfaObrigatorio } = await supabase.rpc('mfa_obrigatorio');
  const { data: gestao } = await supabase.rpc('minhas_organizacoes_gestao');
  const ehGestor = Array.isArray(gestao) && gestao.length > 0;
  const [{ count }, { data: emp }] = await Promise.all([
    supabase.from('colaborador').select('id', { count: 'exact', head: true }).eq('usuario_id', user.id),
    // empresas do seletor do menu (só para quem gere; o RLS já limita ao que a pessoa pode ver)
    ehGestor ? supabase.from('empresa').select('id, razao_social').order('razao_social').limit(300) : Promise.resolve({ data: [] }),
  ]);
  const jar = await cookies();
  return (
    <Casca email={user.email ?? ''} mfaDesligado={mfaObrigatorio === false} temMinhaEscala={(count ?? 0) > 0} temCarteira={ehGestor} ehGestor={ehGestor}
      empresas={linhas<{ id: string; razao_social: string }>(emp).map((e) => ({ id: e.id, nome: e.razao_social }))} estadoMenu={lerEstadoMenu(jar.get(COOKIE_MENU)?.value)}>
      {children}
      <PwaRegistro usuario={await hashUsuario(user.id)} />
    </Casca>
  );
}
