import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { preverSolicitacao, type SolicitacaoLinha } from '@jc/servicos';
import { CartaoDecisao, type PrevisaoVista } from './CartaoDecisao';

const ABAS = [
  { id: 'pendentes', rotulo: 'Para decidir', filtro: (s: SolicitacaoLinha) => s.status === 'pendente' },
  { id: 'aguardando', rotulo: 'Aguardando o colega', filtro: (s: SolicitacaoLinha) => s.status === 'aguardando_colega' },
  { id: 'encerradas', rotulo: 'Encerradas', filtro: (s: SolicitacaoLinha) => ['aprovada', 'recusada', 'cancelada'].includes(s.status) },
] as const;

async function prever(supabase: Awaited<ReturnType<typeof exigirUsuario>>['supabase'], s: SolicitacaoLinha): Promise<PrevisaoVista> {
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

export default async function Solicitacoes({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const empresaId = idOu404((await params).id);
  const abaId = (await searchParams).aba;
  const aba = ABAS.find((a) => a.id === abaId) ?? ABAS[0];
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('solicitacao').select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(200);
  const todas = linhas<SolicitacaoLinha>(data);
  const lista = todas.filter(aba.filtro).slice(0, aba.id === 'pendentes' ? 20 : 50);
  // A conferência das regras só é feita para o que ainda pode ser decidido.
  const previsoes = aba.id === 'pendentes' ? await Promise.all(lista.map((s) => prever(supabase, s))) : [];
  return (
    <>
      <nav aria-label="Filtrar pedidos" className="flex flex-wrap gap-1.5">
        {ABAS.map((a) => {
          const n = todas.filter(a.filtro).length;
          return (
            <Link key={a.id} href={`/empresas/${empresaId}/solicitacoes?aba=${a.id}`} aria-current={a.id === aba.id ? 'page' : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${a.id === aba.id ? 'border-marca bg-marca text-sobre-marca' : 'border-linha bg-cartao hover:bg-marca-suave'}`}>
              {a.rotulo}{n > 0 ? <span className="text-xs opacity-80">({n})</span> : null}
            </Link>
          );
        })}
      </nav>
      <Cartao icone="pedidos" titulo="Pedidos dos colaboradores" subtitulo="Trocas de turno e de folga, férias e afastamentos. Antes de aprovar, o sistema confere se a mudança continua dentro da lei.">
        {lista.length === 0 ? <EstadoVazio titulo="Nenhum pedido aqui">{aba.id === 'pendentes' ? 'Quando um colaborador pedir algo, aparece nesta lista.' : 'Nada nesta aba por enquanto.'}</EstadoVazio> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {lista.map((s, i) => <CartaoDecisao key={s.id} s={s} empresaId={empresaId} previsao={previsoes[i] ?? null} />)}
          </ul>
        )}
      </Cartao>
    </>
  );
}
