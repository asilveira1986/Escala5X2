import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { Cartao, Selo } from '@/components/ui';
import type { SolicitacaoLinha } from '@jc/servicos';
import { dataBr } from '@jc/rules-engine';
import { descreverPedido, ROTULO_STATUS, ROTULO_TIPO, TOM_STATUS } from '@/lib/solicitacoes-ui';
import { DecisaoPedido, type PrevisaoVista } from './DecisaoPedido';

const iniciais = (nome: string) => { const p = nome.trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?'; };

/** Tela do pedido: cabeçalho, resumo, o que foi pedido e a decisão (conferência das regras, aprovar e recusar). */
export function TelaPedido({ s, empresaId, previsao }: { s: SolicitacaoLinha; empresaId: string; previsao: PrevisaoVista | null }) {
  const p = s.payload as Record<string, string>;
  const ausencia = s.tipo === 'ferias' || s.tipo === 'afastamento';
  return (
    <>
      <CabecalhoItem iniciais={iniciais(s.solicitante_nome)} titulo={s.solicitante_nome} subtitulo={`${ROTULO_TIPO[s.tipo]} · pedido em ${dataBr(s.criado_em.slice(0, 10))}`}
        selo={<Selo tom={TOM_STATUS[s.status]}>{ROTULO_STATUS[s.status]}</Selo>} />
      <ResumoItem rotulo="Resumo do pedido" itens={[
        { rotulo: 'Tipo', valor: ROTULO_TIPO[s.tipo] },
        { rotulo: 'Pedido em', valor: <span className="horario">{dataBr(s.criado_em.slice(0, 10))}</span> },
        ausencia ? { rotulo: 'Período', valor: <span className="horario">{dataBr(p.inicio!)} a {dataBr(p.fim!)}</span> } : { rotulo: 'Com', valor: s.destinatario_nome ?? '—' },
      ]} />
      <Cartao titulo="O pedido">
        <div className="space-y-1.5">
          <p className="text-sm">{descreverPedido(s)}</p>
          {s.motivo ? <p className="text-sm text-suave">Motivo do colaborador: {s.motivo}</p> : null}
          {s.decisao_motivo ? <p className="text-sm text-suave">Resposta: {s.decisao_motivo}</p> : null}
          {s.status === 'aprovada' && !ausencia ? <p className="text-xs text-suave">A escala ganhou uma nova versão publicada com essa troca; os colaboradores precisam dar ciência dela de novo.</p> : null}
        </div>
      </Cartao>
      <DecisaoPedido s={s} empresaId={empresaId} previsao={previsao} />
    </>
  );
}
