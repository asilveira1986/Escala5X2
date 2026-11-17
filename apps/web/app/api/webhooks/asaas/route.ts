import { timingSafeEqual } from 'node:crypto';
import { lerEventoAsaas } from '@jc/servicos';
import { NextResponse } from 'next/server';
import { tokenDoWebhook } from '@/lib/cobranca';
import { supabaseServidorRestrito } from '@/lib/supabase/servidor-restrito';

const igual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * Webhook do Asaas. Sem login (quem chama é o Asaas): a autenticação é o segredo no cabeçalho `asaas-access-token`.
 * Responde 200 também para o que ignora (evento desconhecido), para o provedor não reenviar; só falha (5xx) quando o
 * evento é válido e não conseguimos gravá-lo, para ele tentar de novo.
 */
export async function POST(req: Request) {
  const segredo = tokenDoWebhook();
  if (!segredo) return NextResponse.json({ erro: 'webhook não configurado' }, { status: 503 });
  if (!igual(req.headers.get('asaas-access-token') ?? '', segredo)) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  const corpo = await req.json().catch(() => null);
  if (corpo === null) return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  const evento = lerEventoAsaas(corpo);
  if (!evento) return NextResponse.json({ ok: true, ignorado: true });
  const servidor = supabaseServidorRestrito();
  if (!servidor) return NextResponse.json({ erro: 'servidor sem chave de serviço' }, { status: 503 });
  const { data, error } = await servidor.rpc('aplicar_evento_cobranca', { p_provedor: 'asaas', p_evento_id: evento.id, p_tipo: evento.tipo, p_dados: evento.dados });
  if (error) { console.error('[webhook asaas]', evento.id, error.message); return NextResponse.json({ erro: 'falha ao registrar' }, { status: 500 }); }
  return NextResponse.json({ ok: true, resultado: data });
}
