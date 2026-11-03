'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';

const schema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome (mínimo 2 letras).').max(120),
  tipo: z.enum(['empresa', 'contabilidade', 'juridico'], { message: 'Escolha uma opção.' }),
});

export type EstadoOrganizacao = { erros?: Record<string, string>; erroGeral?: string };

/** Primeiro acesso: cria a organização e torna o usuário administrador dela. */
export async function criarOrganizacao(_: EstadoOrganizacao, form: FormData): Promise<EstadoOrganizacao> {
  const r = schema.safeParse({ nome: form.get('nome'), tipo: form.get('tipo') });
  if (!r.success) return { erros: Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const { supabase } = await exigirUsuario();
  const { error } = await supabase.rpc('criar_organizacao', { p_nome: r.data.nome, p_tipo: r.data.tipo });
  if (error) return { erroGeral: 'Não foi possível criar a organização. Tente novamente.' };
  // Administradores precisam da verificação em duas etapas; o middleware leva ao cadastro do autenticador.
  redirect('/empresas');
}
