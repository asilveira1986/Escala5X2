'use server';

import { dataDeInstante, diagnosticar } from '@jc/rules-engine';
import { chamar, ErroServico, lerEntradaDiagnostico } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { paraEmissao, selecionarComunicados } from '@/lib/comunicados';
import { exigirUsuario, idOu404 } from '@/lib/contexto';

export type ResultadoEmissao = { ok: true; novos: number; atualizados: number; mantidos: number } | { ok: false; erro: string };

/** Registra os comunicados da fase no sistema (e avisa quem tem acesso). Reemitir com os mesmos valores não repete nada e preserva a ciência. */
export async function emitirComunicados(empresaId: string, fase: string): Promise<ResultadoEmissao> {
  const f = z.enum(['F1', 'F2']).safeParse(fase);
  let eid: string;
  try { eid = idOu404(empresaId); } catch { return { ok: false, erro: 'Pedido inválido.' }; }
  if (!f.success) return { ok: false, erro: 'Pedido inválido.' };
  const { supabase } = await exigirUsuario();
  try {
    const hoje = dataDeInstante(new Date());
    const entrada = lerEntradaDiagnostico(await chamar(supabase, 'diagnostico_entrada', { p_empresa: eid, p_data: hoje }));
    const sel = selecionarComunicados(diagnosticar(entrada.colaboradores, hoje, entrada.regras), entrada.regras, f.data, null);
    if (!sel || sel.itens.length === 0) return { ok: false, erro: 'Ninguém a adequar nesta fase.' };
    const r = (await chamar(supabase, 'emitir_comunicados', { p_empresa: eid, p_fase: f.data, p_itens: paraEmissao(sel) })) as { novos: number; atualizados: number; mantidos: number };
    revalidatePath(`/empresas/${eid}/prontidao`);
    return { ok: true, novos: r.novos, atualizados: r.atualizados, mantidos: r.mantidos };
  } catch (e) {
    return { ok: false, erro: e instanceof ErroServico ? (/permission|permiss/i.test(e.message) ? 'Você não tem permissão para emitir comunicados desta empresa.' : e.message) : 'Não foi possível emitir agora. Tente de novo.' };
  }
}
