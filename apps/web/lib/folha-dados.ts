import { dataDoNumero, numeroDoDia } from '@jc/rules-engine';
import type { MarcacaoPonto } from '@jc/servicos';
import { todasAsLinhas } from './paginar';

type Cliente = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- cliente do Supabase sem tipos gerados

/** Janela das marcações do mês: um dia antes e dois depois, por causa de turno que vira a noite (UTC-3 fixo). */
export function janelaMarcacoes(inicio: string, fim: string): { de: string; ate: string } {
  return { de: `${dataDoNumero(numeroDoDia(inicio) - 1)}T00:00:00-03:00`, ate: `${dataDoNumero(numeroDoDia(fim) + 2)}T00:00:00-03:00` };
}

/** Marcações já vinculadas a colaboradores no período (todas as páginas). */
export async function carregarMarcacoes(supabase: Cliente, empresaId: string, inicio: string, fim: string): Promise<{ marcacoes: MarcacaoPonto[]; completo: boolean }> {
  const { de, ate } = janelaMarcacoes(inicio, fim);
  const r = await todasAsLinhas<MarcacaoPonto>((a, b) => supabase.from('marcacao_ponto').select('colaborador_id, momento').eq('empresa_id', empresaId)
    .not('colaborador_id', 'is', null).gte('momento', de).lt('momento', ate).order('momento').order('id').range(a, b));
  return { marcacoes: r.linhas, completo: !r.erro && !r.truncado };
}

/** O mês tem alguma marcação importada? (para escolher a origem padrão sem baixar tudo). */
export async function temMarcacoes(supabase: Cliente, empresaId: string, inicio: string, fim: string): Promise<boolean> {
  const { de, ate } = janelaMarcacoes(inicio, fim);
  const { count } = await supabase.from('marcacao_ponto').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).not('colaborador_id', 'is', null).gte('momento', de).lt('momento', ate);
  return (count ?? 0) > 0;
}
