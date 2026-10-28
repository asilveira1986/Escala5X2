'use server';

import { PARAMETROS_PADRAO, type ParametrosCenario, type ResultadoCenario } from '@jc/rules-engine';
import { simularESalvar, ErroServico } from '@jc/servicos';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirUsuario } from '@/lib/contexto';

const pct = (max: number) => z.coerce.number().min(0).max(max);
const schema = z.object({
  diagnosticoId: z.string().uuid(),
  empresaId: z.string().uuid(),
  tipo: z.enum(['contratar', 'horas_extras', 'reorganizar_turnos', 'acordo_compensatorio']),
  fase: z.enum(['F1', 'F2']),
  nome: z.string().trim().max(80).optional(),
  encargosPct: pct(200),
  adicionalHePct: z.coerce.number().min(50, 'O adicional de hora extra não pode ser inferior a 50%.').max(300),
  custoContratacaoReais: z.coerce.number().min(0).max(1_000_000),
  absorcaoPct: pct(100),
  custoAdicionalFolhaPct: pct(100),
  ajusteSalarialPct: z.coerce.number().min(-100).max(100),
});

export type EstadoSimulacao = { erro?: string; resultado?: ResultadoCenario };

export async function simularCenario(_: EstadoSimulacao, form: FormData): Promise<EstadoSimulacao> {
  const r = schema.safeParse(Object.fromEntries(form));
  if (!r.success) return { erro: r.error.issues[0]?.message ?? 'Parâmetros inválidos.' };
  const p = r.data;
  const parametros: ParametrosCenario = {
    ...PARAMETROS_PADRAO, tipo: p.tipo, fase: p.fase, nome: p.nome || undefined, encargosPct: p.encargosPct, adicionalHePct: p.adicionalHePct,
    custoContratacaoUnicoCentavos: Math.round(p.custoContratacaoReais * 100), absorcaoPct: p.absorcaoPct, custoAdicionalFolhaPct: p.custoAdicionalFolhaPct,
    fatorSalario: 1 + p.ajusteSalarialPct / 100,
  };
  const { supabase } = await exigirUsuario();
  try {
    const { resultado } = await simularESalvar(supabase, p.diagnosticoId, parametros);
    revalidatePath(`/empresas/${p.empresaId}/diagnostico/${p.diagnosticoId}`);
    return { resultado };
  } catch (e) {
    return { erro: e instanceof ErroServico ? e.message : 'Não foi possível simular o cenário.' };
  }
}
