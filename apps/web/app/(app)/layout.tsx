import type { ReactNode } from 'react';
import { Casca } from '@/components/Casca';
import { exigirUsuario } from '@/lib/contexto';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, user } = await exigirUsuario();
  // Aviso visível enquanto o MFA estiver desligado (erro na consulta = considera ligado, sem aviso falso).
  const { data: mfaObrigatorio } = await supabase.rpc('mfa_obrigatorio');
  return <Casca email={user.email ?? ''} mfaDesligado={mfaObrigatorio === false}>{children}</Casca>;
}
