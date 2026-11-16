import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

/**
 * As NEXT_PUBLIC_* entram no código na hora do BUILD. Se faltarem, o erro diz exatamente quais são,
 * em vez de um ZodError genérico (que o navegador mostra apenas como "Internal Server Error").
 */
export function env() {
  const r = schema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!r.success) {
    const nomes = [...new Set(r.error.issues.map((i) => String(i.path[0])))].join(', ');
    throw new Error(`Variáveis ausentes ou inválidas no build: ${nomes}. Defina-as no serviço e refaça o build.`);
  }
  return r.data;
}
