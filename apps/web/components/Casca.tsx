import type { ReactNode } from 'react';
import { Shell, type EmpresaDoMenu, type EstadoCobranca } from './Shell';
import type { EstadoMenu } from '@/lib/menu';

/** Estrutura do aplicativo: menu lateral recolhível, barra de cima com o caminho e o conteúdo. */
export function Casca({ email, children, temMinhaEscala = false, temCarteira = false, ehGestor = true, empresas = [], estadoMenu = { recolhido: false, abertos: [] }, naoLidas = 0, cobranca }: {
  email: string; children: ReactNode; temMinhaEscala?: boolean; temCarteira?: boolean; ehGestor?: boolean; empresas?: EmpresaDoMenu[]; estadoMenu?: EstadoMenu; naoLidas?: number; cobranca?: EstadoCobranca;
}) {
  return <Shell cobranca={cobranca} naoLidas={naoLidas} email={email} empresas={empresas} ehGestor={ehGestor} temMinhaEscala={temMinhaEscala} temCarteira={temCarteira} estadoInicial={estadoMenu}>{children}</Shell>;
}
