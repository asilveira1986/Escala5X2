/** Subconjunto de `supabase.rpc(...)`: o mesmo código roda com o cliente do usuário (RLS) e nos testes com pg. */
export type RespostaRpc = { data: unknown; error: { message: string } | null };
export interface ClienteRpc {
  rpc(nome: string, args: Record<string, unknown>): PromiseLike<RespostaRpc>;
}

export class ErroServico extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroServico';
  }
}

export async function chamar(cliente: ClienteRpc, nome: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await cliente.rpc(nome, args);
  if (error) throw new ErroServico(error.message);
  return data;
}
