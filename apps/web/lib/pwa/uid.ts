/** Identificador curto e estável do usuário para marcar as cópias offline (não é segredo: só distingue pessoas no mesmo aparelho). */
export async function hashUsuario(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`jornadacerta:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
