'use server';

import { parseCnpj } from '@jc/connectors';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';

const schema = z.object({
  organizacaoId: z.string().uuid('Escolha a organização.'),
  razaoSocial: z.string().trim().min(2, 'Informe a razão social.').max(200),
  cnpj: z.string().transform((v, ctx) => {
    const d = parseCnpj(v);
    if (!d) ctx.addIssue({ code: 'custom', message: 'CNPJ inválido.' });
    return d ?? '';
  }),
  porte: z.enum(['mei', 'me', 'epp', 'medio', 'grande']),
  municipioIbge: z.string().regex(/^\d{7}$/, 'Código IBGE do município deve ter 7 dígitos.'),
  uf: z.string().length(2, 'UF inválida.').transform((v) => v.toUpperCase()),
  terceirizadaPublica: z.boolean(),
});

export type EstadoCriarEmpresa = { erros?: Record<string, string>; erroGeral?: string };

export async function criarEmpresa(_: EstadoCriarEmpresa, form: FormData): Promise<EstadoCriarEmpresa> {
  const r = schema.safeParse({
    organizacaoId: form.get('organizacaoId'), razaoSocial: form.get('razaoSocial'), cnpj: form.get('cnpj') ?? '',
    porte: form.get('porte'), municipioIbge: form.get('municipioIbge'), uf: form.get('uf') ?? '',
    terceirizadaPublica: form.get('terceirizadaPublica') === 'on',
  });
  if (!r.success) {
    return { erros: Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.from('empresa').insert({
    organizacao_id: r.data.organizacaoId, razao_social: r.data.razaoSocial, cnpj: r.data.cnpj, porte: r.data.porte,
    municipio_ibge: r.data.municipioIbge, uf: r.data.uf, terceirizada_publica: r.data.terceirizadaPublica,
  }).select('id').single();
  if (error) {
    return { erroGeral: /duplicate|unique/i.test(error.message) ? 'Já existe uma empresa com este CNPJ.' : 'Não foi possível criar a empresa. Verifique suas permissões.' };
  }
  revalidatePath('/empresas');
  redirect(`/empresas/${(data as { id: string }).id}/colaboradores`);
}
