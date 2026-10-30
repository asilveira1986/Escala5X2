import type { ReactNode } from 'react';
import { Casca } from '@/components/Casca';
import { exigirUsuario } from '@/lib/contexto';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await exigirUsuario();
  return <Casca email={user.email ?? ''}>{children}</Casca>;
}
