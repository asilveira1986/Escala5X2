/** Dados do comunicado de adequação de jornada (uma página por colaborador). */
export type ItemComunicado = { nome: string; setor: string | null; jornadaAtualMin: number; novaJornadaMin: number };
export type DadosComunicados = {
  empresa: { razaoSocial: string; cnpj: string };
  fase: { rotulo: string; inicio: string; diasTrabalho: number; diasRepouso: number };
  geradoEm: string;
  itens: ItemComunicado[];
};

export const MAX_COMUNICADOS_PDF = 500;
const hm = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
export const jornadaTexto = hm;

/** Parágrafos do comunicado. Minuta: o texto deve ser revisado pelo jurídico da empresa antes do uso. */
export function textoComunicado(d: DadosComunicados, i: ItemComunicado): string[] {
  const inicio = d.fase.inicio.split('-').reverse().join('/');
  return [
    `Comunicamos que, em razão da Emenda Constitucional nº 141/2026, a partir de ${inicio} (${d.fase.rotulo}) a sua jornada de trabalho semanal passará de ${hm(i.jornadaAtualMin)} para ${hm(i.novaJornadaMin)}, distribuída em ${d.fase.diasTrabalho} dias de trabalho e ${d.fase.diasRepouso} dias de repouso semanal remunerado.`,
    'A adequação não reduz o seu salário: o valor mensal é mantido, e o valor da hora de trabalho é recalculado conforme a nova jornada.',
    'Os horários e as folgas de cada semana constarão da escala publicada, da qual você será comunicado(a) nos prazos legais.',
  ];
}
