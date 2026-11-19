import { Abas } from '@/components/Abas';
import { Cartao } from '@/components/ui';
import { lerAba } from '@/lib/abas';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { descreverPedido, ROTULO_TIPO } from '@/lib/solicitacoes-ui';
import { dataBr } from '@jc/rules-engine';
import type { SolicitacaoLinha } from '@jc/servicos';
import { TabelaPedidos, type LinhaPedido } from './TabelaPedidos';

const ABAS = [
  { id: 'pendentes', rotulo: 'Para decidir', filtro: (s: SolicitacaoLinha) => s.status === 'pendente' },
  { id: 'aguardando', rotulo: 'Aguardando o colega', filtro: (s: SolicitacaoLinha) => s.status === 'aguardando_colega' },
  { id: 'encerradas', rotulo: 'Encerradas', filtro: (s: SolicitacaoLinha) => ['aprovada', 'recusada', 'cancelada'].includes(s.status) },
] as const;
const VAZIO = { pendentes: 'Nenhum pedido para decidir. Quando um colaborador pedir algo, aparece aqui.', aguardando: 'Nenhuma troca esperando o colega.', encerradas: 'Nenhum pedido encerrado ainda.' } as const;

export default async function Solicitacoes({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const empresaId = idOu404((await params).id);
  const abaId = lerAba((await searchParams).aba, ABAS);
  const aba = ABAS.find((a) => a.id === abaId) ?? ABAS[0];
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('solicitacao').select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(200);
  const todas = linhas<SolicitacaoLinha>(data);
  const dados: LinhaPedido[] = todas.filter(aba.filtro).slice(0, aba.id === 'pendentes' ? 50 : 100).map((s) => ({
    id: s.id, pessoa: s.solicitante_nome, pedido: ROTULO_TIPO[s.tipo], data: dataBr(s.criado_em.slice(0, 10)), status: s.status, descricao: descreverPedido(s),
  }));
  return (
    <>
      <Abas abas={ABAS.map((a) => ({ id: a.id, rotulo: a.rotulo, contagem: todas.filter(a.filtro).length }))} atual={aba.id} base={`/empresas/${empresaId}/solicitacoes`} rotulo="Filtrar pedidos" />
      <Cartao icone="pedidos" subtitulo="Trocas de turno e de folga, férias e afastamentos. Ao abrir um pedido, o sistema confere se a mudança continua dentro da lei.">
        <TabelaPedidos dados={dados} empresaId={empresaId} vazio={VAZIO[aba.id]} />
      </Cartao>
    </>
  );
}
