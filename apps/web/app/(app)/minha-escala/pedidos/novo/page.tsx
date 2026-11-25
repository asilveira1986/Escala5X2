import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { CabecalhoItem } from '@/components/ItemTela';
import { Cartao, classeBotaoLink } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { FormPedido } from '../FormPedido';
import { escalasParaPedido } from '../dados';

export default async function NovoPedido() {
  const { supabase, user } = await exigirUsuario();
  const { data: colabs } = await supabase.from('colaborador').select('id').eq('usuario_id', user.id);
  const meus = linhas<{ id: string }>(colabs);
  if (meus.length === 0) return <EstadoVazio titulo="Seu cadastro ainda não está ligado a uma escala">Peça ao RH para vincular o seu acesso ao seu cadastro de colaborador.</EstadoVazio>;
  const { hoje, escalas } = await escalasParaPedido(supabase, meus.map((c) => c.id));
  return (
    <>
      <CabecalhoItem icone="mais" titulo="Novo pedido" subtitulo="Troque turno com um colega, mude uma folga ou peça férias. O RH confere se continua dentro da lei antes de aprovar."
        selo={<Link href="/minha-escala/pedidos" className={classeBotaoLink}>Voltar aos pedidos</Link>} />
      <Cartao><FormPedido colaboradorId={meus[0]!.id} escalas={escalas} hoje={hoje} /></Cartao>
    </>
  );
}
