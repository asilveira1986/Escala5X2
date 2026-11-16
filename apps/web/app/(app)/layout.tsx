import type { ReactNode } from 'react';
import { Casca } from '@/components/Casca';
import { PwaRegistro } from '@/components/PwaRegistro';
import { exigirUsuario } from '@/lib/contexto';
import { hashUsuario } from '@/lib/pwa/uid';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, user } = await exigirUsuario();
  // Aviso visível enquanto o MFA estiver desligado (erro na consulta = considera ligado, sem aviso falso).
  const { data: mfaObrigatorio } = await supabase.rpc('mfa_obrigatorio');
  const { data: gestao } = await supabase.rpc('minhas_organizacoes_gestao');
  const { count } = await supabase.from('colaborador').select('id', { count: 'exact', head: true }).eq('usuario_id', user.id);
  return (
    <Casca email={user.email ?? ''} mfaDesligado={mfaObrigatorio === false} temMinhaEscala={(count ?? 0) > 0} temCarteira={Array.isArray(gestao) && gestao.length > 0}>
      {children}
      <PwaRegistro usuario={await hashUsuario(user.id)} />
    </Casca>
  );
}
