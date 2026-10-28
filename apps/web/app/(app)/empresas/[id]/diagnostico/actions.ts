'use server';

import { executarDiagnostico, ErroServico } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';

const dataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');

export type EstadoDiagnostico = { erro?: string };

export async function rodarDiagnostico(_: EstadoDiagnostico, form: FormData): Promise<EstadoDiagnostico> {
  const empresaId = z.string().uuid().safeParse(form.get('empresaId'));
  const dataRef = dataSchema.safeParse(form.get('dataReferencia'));
  if (!empresaId.success || !dataRef.success) return { erro: 'Informe uma data de referência válida.' };
  const { supabase } = await exigirUsuario();
  let id: string;
  try {
    const r = await executarDiagnostico(supabase, empresaId.data, dataRef.data);
    id = r.diagnosticoId;
    // Status de adequação da empresa (best effort: perfis só de leitura não conseguem atualizar).
    const c = r.diagnostico.resumo.porClassificacao;
    await supabase.from('empresa').update({ status_adequacao: c.adequacao_f1 + c.adequacao_f2 > 0 ? 'em_risco' : 'adequado' }).eq('id', empresaId.data);
  } catch (e) {
    if (e instanceof ErroServico) return { erro: /sem permiss/i.test(e.message) ? 'Você não tem permissão para esta empresa.' : e.message };
    return { erro: 'Não foi possível gerar o diagnóstico. Verifique os dados dos colaboradores e tente novamente.' };
  }
  revalidatePath(`/empresas/${empresaId.data}/diagnostico`);
  redirect(`/empresas/${empresaId.data}/diagnostico/${id}`);
}
