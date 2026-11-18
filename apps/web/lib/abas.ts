export type Aba = { id: string; rotulo: string; /** Número que aparece ao lado do rótulo (pendências, itens). */ contagem?: number };

/** Aba pedida na URL (?aba=…): só vale se existir; senão, a primeira. */
export function lerAba(valor: unknown, abas: readonly Pick<Aba, 'id'>[]): string {
  return typeof valor === 'string' && abas.some((a) => a.id === valor) ? valor : abas[0]!.id;
}

/** Endereço da aba mantendo os outros parâmetros da URL (ex.: o mês); a primeira aba fica sem ?aba para o endereço limpo. */
export function hrefDaAba(base: string, abas: readonly Pick<Aba, 'id'>[], id: string, extras: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extras)) if (v) q.set(k, v);
  if (id !== abas[0]!.id) q.set('aba', id);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
