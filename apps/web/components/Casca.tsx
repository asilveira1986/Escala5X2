import type { ReactNode } from 'react';
import { Shell, type EmpresaDoMenu, type EstadoCobranca } from './Shell';
import type { EstadoMenu } from '@/lib/menu';

/** Estrutura do aplicativo: menu lateral recolhível, barra de cima com o caminho e o conteúdo. */
export function Casca({ email, children, mfaDesligado = false, temMinhaEscala = false, temCarteira = false, ehGestor = true, empresas = [], estadoMenu = { recolhido: false, abertos: [] }, naoLidas = 0, cobranca }: {
  email: string; children: ReactNode; mfaDesligado?: boolean; temMinhaEscala?: boolean; temCarteira?: boolean; ehGestor?: boolean; empresas?: EmpresaDoMenu[]; estadoMenu?: EstadoMenu; naoLidas?: number; cobranca?: EstadoCobranca;
}) {
  const aviso = mfaDesligado ? (
    <div role="status" className="bg-atencao-bg px-4 py-2 text-center text-sm font-semibold text-atencao-fg">
      Modo de teste: a verificação em duas etapas está <strong>desativada</strong> neste ambiente. Não use dados reais.
    </div>
  ) : null;
  return <Shell cobranca={cobranca} naoLidas={naoLidas} email={email} empresas={empresas} ehGestor={ehGestor} temMinhaEscala={temMinhaEscala} temCarteira={temCarteira} estadoInicial={estadoMenu} aviso={aviso}>{children}</Shell>;
}
