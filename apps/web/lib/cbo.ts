/**
 * CBO (Classificação Brasileira de Ocupações, base de 2002): busca para o seletor.
 * A lista fica em cbo-dados.json ([código "2521-05", nome]); aqui só há funções puras, para testar sem navegador.
 */
export type OcupacaoCbo = readonly [codigo: string, nome: string];

export const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** "252105" ou "2521-05" → "2521-05"; qualquer outra coisa → null. */
export function formatarCbo(valor: string): string | null {
  const d = valor.replace(/\D/g, '');
  return /^\d{6}$/.test(valor.replace(/[-\s]/g, '')) && d.length === 6 ? `${d.slice(0, 4)}-${d.slice(4)}` : null;
}

const cache = new WeakMap<readonly OcupacaoCbo[], string[]>();
const nomesNormalizados = (lista: readonly OcupacaoCbo[]) => {
  let n = cache.get(lista);
  if (!n) { n = lista.map(([, nome]) => semAcento(nome)); cache.set(lista, n); }
  return n;
};

/**
 * Busca por código (começo do número, com ou sem hífen) ou por palavras do nome, sem diferenciar acentos nem maiúsculas.
 * Quem começa com o que foi digitado vem primeiro; depois quem tem a palavra no começo; depois o resto.
 */
export function buscarCbo(lista: readonly OcupacaoCbo[], consulta: string, limite = 8): OcupacaoCbo[] {
  const q = semAcento(consulta).trim();
  if (!q) return [];
  if (/^[\d-]+$/.test(q)) {
    const dig = q.replace(/\D/g, '');
    if (!dig) return [];
    return lista.filter(([c]) => c.replace('-', '').startsWith(dig)).slice(0, limite);
  }
  const palavras = q.split(/\s+/);
  const nomes = nomesNormalizados(lista);
  const achados: { i: number; peso: number }[] = [];
  for (let i = 0; i < lista.length; i++) {
    const n = nomes[i]!;
    if (!palavras.every((p) => n.includes(p))) continue;
    const peso = n.startsWith(q) ? 0 : n.includes(` ${palavras[0]}`) ? 1 : 2;
    achados.push({ i, peso });
  }
  achados.sort((a, b) => a.peso - b.peso || a.i - b.i);
  return achados.slice(0, limite).map((a) => lista[a.i]!);
}

export const rotuloCbo = ([codigo, nome]: OcupacaoCbo) => `${codigo} · ${nome}`;
