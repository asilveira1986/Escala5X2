import { preverSolicitacao, type SolicitacaoLinha } from '@jc/servicos';
import type { exigirUsuario } from '@/lib/contexto';
import type { PrevisaoVista } from './DecisaoPedido';

/** Confere o pedido com as regras da escala (só para o que ainda pode ser decidido); falha vira uma mensagem, nunca derruba a tela. */
export async function prever(supabase: Awaited<ReturnType<typeof exigirUsuario>>['supabase'], s: SolicitacaoLinha): Promise<PrevisaoVista> {
  try {
    const p = await preverSolicitacao(supabase, s);
    return {
      resumo: p.resumo, erro: p.erro, conflitos: p.conflitos,
      bloqueios: p.impacto?.bloqueios ?? 0, alertas: p.impacto?.alertas ?? 0,
      problemas: (p.impacto?.novas ?? []).slice(0, 5).map((v) => ({ severidade: v.severidade, mensagem: v.mensagem })),
    };
  } catch {
    return { resumo: '', erro: 'Não foi possível conferir as regras agora. Tente recarregar a página.', conflitos: [], bloqueios: 0, alertas: 0, problemas: [] };
  }
}
