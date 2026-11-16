import { mesVizinho } from './carteira';

/** Mês de fechamento a partir do parâmetro ?mes=AAAA-MM; sem ele (ou inválido), o mês passado. */
export function lerCompetencia(v: unknown, hoje: string): { mes: string; dia: string } {
  const valido = typeof v === 'string' && /^(\d{4})-(0[1-9]|1[0-2])$/.test(v);
  const mes = valido ? (v as string) : mesVizinho(hoje.slice(0, 7), -1);
  return { mes, dia: `${mes}-01` };
}

/** Só se fecha mês encerrado (o mês corrente e os futuros ainda mudam). */
export const mesEncerrado = (mes: string, hoje: string): boolean => mes < hoje.slice(0, 7);

const NOMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const rotuloMes = (mes: string): string => `${NOMES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;

/** folha-loja-alfa-ltda-2027-02-v2.csv (sem acentos, só letras minúsculas, números e hífen). */
export function nomeArquivo(razaoSocial: string, mes: string, versao: number, extensao: 'csv' | 'xlsx'): string {
  const slug = razaoSocial.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'empresa';
  return `folha-${slug}-${mes}-v${versao}.${extensao}`;
}
