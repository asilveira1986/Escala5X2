/** Decisão pura (testável) de redirecionamento por autenticação. */
export type EntradaAcesso = { caminho: string; autenticado: boolean };

const PUBLICAS = ['/login', '/auth/callback', '/auth/confirmar'];

export function decidirAcesso(e: EntradaAcesso): string | null {
  const publica = PUBLICAS.some((p) => e.caminho === p || e.caminho.startsWith(`${p}/`));
  if (!e.autenticado) return publica ? null : '/login';
  if (e.caminho === '/login') return '/';
  return null;
}
