import type { Diagnostico, ResultadoCenario } from '@jc/rules-engine';

export type Marca = {
  /** Nome do escritório contábil (white label). */
  nome: string;
  /** Cor primária em #RRGGBB. */
  corPrimaria: string;
  /** Logo PNG ou JPG. */
  logo?: Uint8Array | null;
};

export type DadosRelatorio = {
  empresa: { razaoSocial: string; cnpj: string };
  /** Data de geração, aaaa-mm-dd. */
  geradoEm: string;
  marca: Marca;
  diagnostico: Diagnostico;
  cenarios: Array<{ nome: string; resultado: ResultadoCenario }>;
};

export const MARCA_PADRAO: Marca = { nome: 'JornadaCerta', corPrimaria: '#1d4ed8' };

export function corValida(c: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(c);
}
