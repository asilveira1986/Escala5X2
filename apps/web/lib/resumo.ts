import type { Diagnostico } from '@jc/rules-engine';
import { data, decimal, inteiro } from '@jc/documents/formatar';

export type ResumoSimples = { nivel: 'ok' | 'atencao'; titulo: string; detalhe: string; percentualAdequado: number; primeiroPrazo: string | null };

/** Frase em português simples para quem não é técnico: quantas pessoas precisam mudar e até quando. */
export function resumoSimples(d: Diagnostico): ResumoSimples {
  const c = d.resumo.porClassificacao;
  const total = d.resumo.total;
  const precisam = c.adequacao_f1 + c.adequacao_f2;
  const percentualAdequado = total === 0 ? 0 : Math.round(((c.adequado + c.excecao) / total) * 100);
  if (precisam === 0) {
    return { nivel: 'ok', titulo: 'Tudo certo: ninguém precisa mudar de escala', detalhe: `As ${inteiro(total)} pessoas analisadas já cumprem as regras vigentes, ou têm uma exceção válida.`, percentualAdequado, primeiroPrazo: null };
  }
  const prazos = d.itens.map((i) => (i.f1 && !i.f1.conforme ? i.f1.prazo : null)).filter((p): p is string => !!p).sort();
  const primeiroPrazo = prazos[0] ?? (c.adequacao_f2 > 0 ? d.fases.f2Inicio : null);
  const verbo = precisam === 1 ? 'precisa' : 'precisam';
  const pessoas = precisam === 1 ? 'pessoa' : 'pessoas';
  const partes: string[] = [];
  if (primeiroPrazo) partes.push(`O primeiro prazo é ${data(primeiroPrazo)}.`);
  if (d.resumo.fteF2 > 0) partes.push(`Para cobrir as horas que deixam de ser trabalhadas na fase 2, faltam cerca de ${decimal(d.resumo.fteF2, 1)} ${d.resumo.fteF2 >= 1.95 ? 'pessoas' : 'pessoa'} em tempo integral.`);
  return {
    nivel: 'atencao', titulo: `${inteiro(precisam)} de ${inteiro(total)} ${pessoas} ${verbo} se adequar`,
    detalhe: partes.join(' '), percentualAdequado, primeiroPrazo,
  };
}
