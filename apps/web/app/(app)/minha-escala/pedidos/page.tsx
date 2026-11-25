import Link from 'next/link';
import { Abas } from '@/components/Abas';
import { EstadoVazio } from '@/components/EstadoVazio';
import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { Aviso, Cartao, classeBotaoLinkPrimario } from '@/components/ui';
import { lerAba } from '@/lib/abas';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { ABERTA } from '@/lib/solicitacoes-ui';
import type { SolicitacaoLinha } from '@jc/servicos';
import { ListaPedidos } from './ListaPedidos';

const ABAS = [{ id: 'andamento', rotulo: 'Em andamento' }, { id: 'encerrados', rotulo: 'Encerrados' }];

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ aba?: string; enviado?: string }> }) {
  const sp = await searchParams;
  const { supabase, user } = await exigirUsuario();
  const { data: colabs } = await supabase.from('colaborador').select('id, nome').eq('usuario_id', user.id);
  const meus = linhas<{ id: string; nome: string }>(colabs);
  if (meus.length === 0) return <EstadoVazio titulo="Seu cadastro ainda não está ligado a uma escala">Peça ao RH para vincular o seu acesso ao seu cadastro de colaborador.</EstadoVazio>;
  const ids = meus.map((c) => c.id).join(',');
  // O RLS deixa a gestão ver a empresa toda; aqui só entram os pedidos da própria pessoa ou dirigidos a ela.
  const { data: sol } = await supabase.from('solicitacao').select('*').or(`solicitante_id.in.(${ids}),destinatario_id.in.(${ids})`).order('criado_em', { ascending: false }).limit(100);
  const todos = linhas<SolicitacaoLinha>(sol);
  const meusIds = new Set(meus.map((c) => c.id));
  const meusPedidos = todos.filter((p) => meusIds.has(p.solicitante_id));
  const paraMim = todos.filter((p) => p.destinatario_id && meusIds.has(p.destinatario_id) && p.status === 'aguardando_colega');
  const abertos = meusPedidos.filter(ABERTA), encerrados = meusPedidos.filter((p) => !ABERTA(p));
  const aba = lerAba(sp.aba, ABAS);
  const lista = aba === 'andamento' ? abertos : encerrados;

  return (
    <>
      <CabecalhoItem icone="pedidos" titulo="Meus pedidos" subtitulo="Troque turno com um colega, mude uma folga ou peça férias."
        selo={<Link href="/minha-escala/pedidos/novo" className={classeBotaoLinkPrimario}>Novo pedido</Link>} />
      {sp.enviado ? <Aviso tipo="ok">Pedido enviado. O andamento aparece aqui.</Aviso> : null}
      <ResumoItem rotulo="Resumo dos pedidos" itens={[
        { rotulo: 'Esperando você', valor: <span className={`horario ${paraMim.length > 0 ? 'text-atencao-fg' : ''}`}>{paraMim.length}</span> },
        { rotulo: 'Em andamento', valor: <span className="horario">{abertos.length}</span> },
        { rotulo: 'Aprovados', valor: <span className="horario text-ok-fg">{meusPedidos.filter((p) => p.status === 'aprovada').length}</span> },
        { rotulo: 'Recusados', valor: <span className="horario">{meusPedidos.filter((p) => p.status === 'recusada').length}</span> },
      ]} />
      {paraMim.length > 0 ? (
        <Cartao icone="pedidos" titulo="Pedidos de colegas para você" subtitulo="Se você aceitar, o pedido segue para o RH decidir.">
          <ListaPedidos pedidos={paraMim} modo="para-mim" />
        </Cartao>
      ) : null}
      <Abas abas={ABAS.map((a) => ({ ...a, contagem: a.id === 'andamento' ? abertos.length : undefined }))} atual={aba} base="/minha-escala/pedidos" rotulo="Seções dos pedidos" />
      <Cartao icone="pedidos" titulo={`${lista.length} ${lista.length === 1 ? 'pedido' : 'pedidos'}`}>
        {lista.length === 0
          ? <EstadoVazio titulo={aba === 'andamento' ? 'Nenhum pedido em andamento' : 'Nenhum pedido encerrado'}>{aba === 'andamento' ? 'Use "Novo pedido" para pedir uma troca, folga ou férias.' : 'Pedidos aprovados, recusados ou cancelados aparecem aqui.'}</EstadoVazio>
          : <ListaPedidos pedidos={lista} modo="meus" />}
      </Cartao>
    </>
  );
}
