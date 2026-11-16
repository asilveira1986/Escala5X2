import Link from 'next/link';
import type { ReactNode } from 'react';
import { Cartao } from '@/components/ui';
import { exigirUsuario, idOu404 } from '@/lib/contexto';

function Atalho({ href, titulo, numero, texto, destaque }: { href: string; titulo: string; numero?: number | null; texto: string; destaque?: boolean }): ReactNode {
  return (
    <Link href={href} className={`block rounded-2xl border p-4 transition-colors hover:border-marca ${destaque ? 'border-atencao-fg/40 bg-atencao-bg' : 'border-linha bg-cartao'}`}>
      <span className="text-sm font-semibold text-suave">{titulo}</span>
      {numero != null ? <span className="mt-1 block text-3xl font-bold leading-none">{numero}</span> : null}
      <span className="mt-2 block text-sm">{texto}</span>
    </Link>
  );
}

export default async function VisaoGeral({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const cont = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [colab, turnos, publicadas, rascunhos, pendentes] = await Promise.all([
    cont(supabase.from('colaborador').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).is('desligamento', null)),
    cont(supabase.from('turno_modelo').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('ativo', true)),
    cont(supabase.from('escala').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'publicada')),
    cont(supabase.from('escala').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'rascunho')),
    cont(supabase.from('solicitacao').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'pendente')),
  ]);
  const base = `/empresas/${empresaId}`;
  const passos = [
    { ok: colab > 0, texto: 'Cadastrar os colaboradores', href: `${base}/colaboradores` },
    { ok: turnos > 0, texto: 'Cadastrar os turnos', href: `${base}/escalas/turnos` },
    { ok: publicadas > 0, texto: 'Montar e publicar a primeira escala', href: `${base}/escalas` },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Atalho href={`${base}/colaboradores`} titulo="Colaboradores ativos" numero={colab} texto="Ver e cadastrar equipe" />
        <Atalho href={`${base}/escalas`} titulo="Escalas publicadas" numero={publicadas} texto={rascunhos > 0 ? `${rascunhos} em rascunho` : 'Montar o mês'} />
        <Atalho href={`${base}/solicitacoes`} titulo="Pedidos para decidir" numero={pendentes} texto={pendentes > 0 ? 'Há pedidos esperando' : 'Nada pendente'} destaque={pendentes > 0} />
        <Atalho href={`${base}/escalas/turnos`} titulo="Turnos" numero={turnos} texto="Modelos de horário" />
      </div>
      {passos.some((p) => !p.ok) ? (
        <Cartao titulo="Primeiros passos" subtitulo="O caminho mais curto até a escala publicada.">
          <ol className="space-y-1">
            {passos.map((p, i) => (
              <li key={p.href}>
                <Link href={p.href} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fundo">
                  <span aria-hidden className={`grid size-7 place-items-center rounded-full text-sm font-bold ${p.ok ? 'bg-ok-bg text-ok-fg' : 'bg-marca-suave text-marca'}`}>{p.ok ? '✓' : i + 1}</span>
                  <span className={p.ok ? 'text-suave line-through' : 'font-semibold'}>{p.texto}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Cartao>
      ) : null}
      <Cartao titulo="Atalhos">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm font-semibold">
          {[['Diagnóstico da adequação', 'diagnostico'], ['Cobertura mínima', 'escalas/cobertura'], ['Férias e afastamentos', 'escalas/ausencias'], ['Banco de horas', 'banco-horas'], ['Ponto (AFD)', 'ponto'], ['Fechamento da folha', 'folha']].map(([t, h]) => (
            <Link key={h} href={`${base}/${h}`} className="flex min-h-11 items-center rounded-xl border border-linha px-3 hover:bg-marca-suave">{t}</Link>
          ))}
        </div>
      </Cartao>
    </>
  );
}
