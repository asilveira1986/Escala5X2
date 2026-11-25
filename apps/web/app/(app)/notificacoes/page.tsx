import { EstadoVazio } from '@/components/EstadoVazio';
import { ItemNotificacao } from '@/components/Sino';
import { CabecalhoItem } from '@/components/ItemTela';
import { Cartao } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import type { Notificacao } from '@/lib/notificacoes';
import { MarcarTodas } from './MarcarTodas';

export default async function Notificacoes() {
  const { supabase } = await exigirUsuario();
  const { data, error } = await supabase.from('notificacao').select('id, tipo, titulo, texto, href, criado_em, lida_em').order('criado_em', { ascending: false }).limit(100);
  const itens = linhas<Notificacao>(data);
  const naoLidas = itens.filter((n) => !n.lida_em).length;
  return (
    <>
      <CabecalhoItem icone="pedidos" titulo="Notificações" subtitulo={naoLidas > 0 ? `${naoLidas} ${naoLidas === 1 ? 'não lida' : 'não lidas'} · as 100 mais recentes` : 'Avisos sobre pedidos e escalas. As 100 mais recentes.'} selo={naoLidas > 0 ? <MarcarTodas /> : undefined} />
      <Cartao>
        {error ? <p className="text-sm text-suave">Não foi possível carregar as notificações agora.</p>
          : itens.length === 0 ? <EstadoVazio titulo="Nenhuma notificação ainda">Quando um pedido chegar, for decidido ou uma escala for publicada, você é avisado aqui e no sino.</EstadoVazio>
          : <ul className="-mx-1 space-y-0.5">{itens.map((n) => <li key={n.id}><ItemNotificacao n={n} /></li>)}</ul>}
      </Cartao>
    </>
  );
}
