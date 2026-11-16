import { ImageResponse } from 'next/og';
import { iconeJornada } from '@/lib/pwa/icone';

export const dynamic = 'force-static';

const TAMANHOS = { '192': { px: 192, mascara: false }, '512': { px: 512, mascara: false }, '512-maskable': { px: 512, mascara: true } } as const;
export function generateStaticParams() { return Object.keys(TAMANHOS).map((tamanho) => ({ tamanho })); }

export async function GET(_: Request, { params }: { params: Promise<{ tamanho: string }> }) {
  const t = TAMANHOS[(await params).tamanho as keyof typeof TAMANHOS];
  if (!t) return new Response('não encontrado', { status: 404 });
  return new ImageResponse(iconeJornada(t.px, t.mascara), { width: t.px, height: t.px });
}
