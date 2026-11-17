import { EstadoVazio } from '@/components/EstadoVazio';
import { CabecalhoPagina, Cartao } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { agruparPorEscala, textoTurno, type LinhaMinhaEscala } from '@/lib/minha-escala';
import type { TurnoColega } from '@/lib/solicitacoes-ui';
import { dataBr, dataDeInstante, diaDaSemana } from '@jc/rules-engine';
import type { SolicitacaoLinha } from '@jc/servicos';
import { FormPedido, type EscalaParaPedido } from './FormPedido';
import { ListaPedidos } from './ListaPedidos';

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export default async function Pedidos() {
  const { supabase, user } = await exigirUsuario();
  const { data: colabs } = await supabase.from('colaborador').select('id, nome').eq('usuario_id', user.id);
  const meus = linhas<{ id: string; nome: string }>(colabs);
  if (meus.length === 0) return <EstadoVazio titulo="Seu cadastro ainda não está ligado a uma escala">Peça ao RH para vincular o seu acesso ao seu cadastro de colaborador.</EstadoVazio>;
  const ids = meus.map((c) => c.id).join(',');
  const hoje = dataDeInstante(new Date());

  const [{ data: sol }, { data: aloc }] = await Promise.all([
    // O RLS deixa a gestão ver a empresa toda; aqui só entram os pedidos da própria pessoa ou dirigidos a ela.
    supabase.from('solicitacao').select('*').or(`solicitante_id.in.(${ids}),destinatario_id.in.(${ids})`).order('criado_em', { ascending: false }).limit(100),
    supabase.from('alocacao')
      .select('escala_id, data, tipo, inicio_min, fim_min, intervalo_min, escala!inner(id, nome, periodo, versao, publicada_em, hash_publicado, status)')
      .in('colaborador_id', meus.map((c) => c.id)).eq('escala.status', 'publicada').gte('data', hoje).order('data'),
  ]);
  const todos = linhas<SolicitacaoLinha>(sol);
  const meusIds = new Set(meus.map((c) => c.id));
  const meusPedidos = todos.filter((p) => meusIds.has(p.solicitante_id));
  const paraMim = todos.filter((p) => p.destinatario_id && meusIds.has(p.destinatario_id) && p.status === 'aguardando_colega');
  const escalas = agruparPorEscala(linhas<LinhaMinhaEscala>(aloc), []);

  const paraForm: EscalaParaPedido[] = await Promise.all(escalas.map(async (e) => {
    const rotulo = (d: { data: string; tipo: string; inicioMin: number | null; fimMin: number | null; intervaloMin: number }) =>
      `${DIAS[diaDaSemana(d.data)]}, ${dataBr(d.data)} · ${textoTurno({ tipo: d.tipo as never, inicioMin: d.inicioMin, fimMin: d.fimMin, intervaloMin: d.intervaloMin })}`;
    const { data: col } = await supabase.rpc('escala_colegas', { p_escala: e.id });
    return {
      id: e.id, nome: `${e.nome} (versão ${e.versao})`,
      diasTrabalho: e.dias.filter((d) => d.tipo === 'trabalho').map((d) => ({ data: d.data, rotulo: rotulo(d) })),
      diasFolga: e.dias.filter((d) => d.tipo === 'folga' || d.tipo === 'dsr').map((d) => ({ data: d.data, rotulo: rotulo(d) })),
      colegas: linhas<TurnoColega>(col).filter((c) => !meusIds.has(c.colaborador_id)),
    };
  }));

  return (
    <>
      <CabecalhoPagina icone="pedidos" titulo="Meus pedidos" descricao="Troque turno com um colega, mude uma folga ou peça férias. O RH confere se continua dentro da lei antes de aprovar." />
      {paraMim.length > 0 ? (
        <Cartao icone="pedidos" titulo="Pedidos de colegas para você" subtitulo="Se você aceitar, o pedido segue para o RH decidir.">
          <ListaPedidos pedidos={paraMim} modo="para-mim" />
        </Cartao>
      ) : null}
      <Cartao icone="mais" titulo="Novo pedido"><FormPedido colaboradorId={meus[0]!.id} escalas={paraForm} hoje={hoje} /></Cartao>
      <Cartao icone="pedidos" titulo="Meus pedidos">
        {meusPedidos.length === 0 ? <EstadoVazio titulo="Você ainda não fez pedidos">Quando fizer, o andamento aparece aqui.</EstadoVazio> : (
          <ListaPedidos pedidos={meusPedidos} modo="meus" />
        )}
      </Cartao>
    </>
  );
}
