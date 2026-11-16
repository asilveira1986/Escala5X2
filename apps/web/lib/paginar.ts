/**
 * O PostgREST do Supabase devolve no máximo 1000 linhas por consulta (`Max Rows`), mesmo com `.limit(20000)`.
 * Esta função lê todas as páginas com `.range(de, até)` até acabar (ou até `maximo`, para não puxar a base inteira por engano).
 */
export async function todasAsLinhas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
  opcoes: { tamanho?: number; maximo?: number } = {},
): Promise<{ linhas: T[]; truncado: boolean; erro: boolean }> {
  const tamanho = opcoes.tamanho ?? 1000, maximo = opcoes.maximo ?? 200_000;
  const linhas: T[] = [];
  for (let de = 0; de < maximo; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1);
    if (error) return { linhas, truncado: false, erro: true };
    const lote = Array.isArray(data) ? (data as T[]) : [];
    linhas.push(...lote);
    if (lote.length < tamanho) return { linhas, truncado: false, erro: false };
  }
  return { linhas, truncado: true, erro: false };
}
