/** Decisão pura (testável) de redirecionamento por autenticação e MFA. */
export const PAPEIS_COM_MFA = ['superadmin', 'admin', 'contador', 'advogado'] as const;

export type EntradaAcesso = {
  caminho: string;
  autenticado: boolean;
  nivelAtual: 'aal1' | 'aal2' | null;
  papeis: string[];
  /** true quando o usuário já tem um fator TOTP verificado (nextLevel = aal2). */
  mfaCadastrado: boolean;
  /**
   * Interruptor de MFA (tabela configuracao_sistema). Padrão seguro: se não vier informado, o MFA é exigido.
   * Só `false` exato dispensa a verificação.
   */
  mfaObrigatorio?: boolean;
};

/** Papéis que exigem MFA, quando o interruptor está ligado. */
export const exigeMfaPara = (papeis: string[], mfaObrigatorio: boolean | undefined): boolean =>
  mfaObrigatorio !== false && papeis.some((p) => (PAPEIS_COM_MFA as readonly string[]).includes(p));

const PUBLICAS = ['/login', '/auth/callback', '/auth/confirmar'];

export function decidirAcesso(e: EntradaAcesso): string | null {
  const publica = PUBLICAS.some((p) => e.caminho === p || e.caminho.startsWith(`${p}/`));
  if (!e.autenticado) return publica ? null : '/login';

  const exigeMfa = exigeMfaPara(e.papeis, e.mfaObrigatorio);
  if (exigeMfa && e.nivelAtual !== 'aal2') {
    // Sem fator cadastrado: cadastrar; com fator: verificar código.
    const alvo = e.mfaCadastrado ? '/mfa' : '/mfa?etapa=cadastro';
    return e.caminho === '/mfa' ? null : alvo;
  }
  if (e.caminho === '/login' || e.caminho === '/mfa') return '/';
  return null;
}
