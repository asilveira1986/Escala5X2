import { Abas } from '@/components/Abas';
import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { Aviso, Cartao, Selo } from '@/components/ui';
import { moeda, ROTULO_FORMA } from '@/lib/cobranca';
import { dataBr } from '@jc/rules-engine';
import type { FormaPagamento, StatusAssinatura } from '@jc/servicos';
import { CancelarAssinatura, EscolhaPlano } from './AcoesCobranca';
import { TabelaFaturas, type LinhaFatura } from './TabelaFaturas';

export type Plano = { id: string; codigo: string; nome: string; descricao: string | null; preco_centavos: number; limite_colaboradores: number | null };
export type Assinatura = { id: string; status: StatusAssinatura; plano_id: string | null; teste_ate: string | null; forma: FormaPagamento | null; proximo_vencimento: string | null };
export const ABAS_COBRANCA = [{ id: 'plano', rotulo: 'Planos' }, { id: 'faturas', rotulo: 'Faturas' }];

const ROTULO_STATUS = { teste: 'Em teste', aguardando_pagamento: 'Aguardando pagamento', ativa: 'Ativa', inadimplente: 'Fatura vencida', cancelada: 'Cancelada' } as const;
const tomStatus = { teste: 'azul', aguardando_pagamento: 'amarelo', ativa: 'verde', inadimplente: 'vermelho', cancelada: 'cinza' } as const;

type Props = {
  orgId: string; orgNome: string; assinatura: Assinatura | null; planos: Plano[]; faturas: LinhaFatura[]; ativos: number; excedeLimite: boolean;
  aviso: { tom: 'info' | 'atencao' | 'risco'; texto: string } | null; configurado: boolean; aba: string;
};

/** Tela de Plano e cobrança: cabeçalho com a situação, resumo da assinatura sempre à vista e abas (planos, faturas). */
export function TelaCobranca({ orgId, orgNome, assinatura, planos, faturas, ativos, excedeLimite, aviso, configurado, aba }: Props) {
  const atual = planos.find((p) => p.id === assinatura?.plano_id) ?? null;
  const emAndamento = !!assinatura && ['ativa', 'aguardando_pagamento', 'inadimplente'].includes(assinatura.status);
  const abertas = faturas.filter((f) => f.status === 'pendente' || f.status === 'vencida').length;
  const data = assinatura ? (assinatura.status === 'teste' ? assinatura.teste_ate : assinatura.proximo_vencimento) : null;
  return (
    <>
      {!configurado ? <Aviso>A cobrança ainda não está configurada neste ambiente (faltam as chaves do provedor de pagamento no servidor). Os planos abaixo são só para consulta.</Aviso> : null}
      {aviso ? <Aviso tipo={aviso.tom === 'risco' ? 'erro' : 'info'}>{aviso.texto}</Aviso> : null}

      <CabecalhoItem icone="folha" titulo="Plano e cobrança" subtitulo={`Assinatura de ${orgNome}`}
        selo={assinatura ? <Selo tom={tomStatus[assinatura.status]}>{ROTULO_STATUS[assinatura.status]}</Selo> : undefined} />
      {assinatura ? (
        <ResumoItem rotulo="Resumo da assinatura" itens={[
          { rotulo: 'Plano', valor: atual ? `${atual.nome} · ${moeda(atual.preco_centavos)}/mês` : '—' },
          { rotulo: assinatura.status === 'teste' ? 'Teste até' : 'Próximo vencimento', valor: <span className="horario">{data ? dataBr(data) : '—'}</span> },
          { rotulo: 'Forma de pagamento', valor: assinatura.forma ? ROTULO_FORMA[assinatura.forma] : '—' },
          { rotulo: 'Colaboradores ativos', valor: <span className={`horario ${excedeLimite ? 'text-atencao-fg' : ''}`}>{ativos}{atual?.limite_colaboradores ? ` de ${atual.limite_colaboradores}` : ''}</span> },
        ]} />
      ) : null}

      <Abas abas={ABAS_COBRANCA.map((a) => (a.id === 'faturas' ? { ...a, contagem: abertas } : a))} atual={aba} base="/cobranca" rotulo="Seções do plano e da cobrança" />

      {aba === 'plano' ? (
        <>
          <Cartao icone="banco" titulo="Planos" subtitulo="Preço mensal por organização, conforme o número de colaboradores ativos.">
            <ul className="grid gap-3 md:grid-cols-3">
              {planos.map((p) => (
                <li key={p.id} className={`flex flex-col gap-2 rounded-2xl border p-4 ${p.id === atual?.id ? 'border-marca bg-marca-suave/40' : 'border-linha'}`}>
                  <h3 className="text-base font-bold">{p.nome}</h3>
                  <p className="horario text-2xl font-bold">{moeda(p.preco_centavos)}<span className="font-[family-name:var(--font-texto)] text-sm font-medium text-suave">/mês</span></p>
                  <p className="text-sm text-suave">{p.limite_colaboradores ? `Até ${p.limite_colaboradores} colaboradores` : 'Colaboradores ilimitados'}</p>
                  {p.descricao ? <p className="text-xs text-suave">{p.descricao}</p> : null}
                  <div className="mt-auto pt-2">{configurado ? <EscolhaPlano orgId={orgId} planoId={p.id} atual={p.id === atual?.id} emAndamento={emAndamento} rotulo={p.nome} /> : null}</div>
                </li>
              ))}
            </ul>
          </Cartao>
          {emAndamento ? <Cartao titulo="Encerrar a assinatura"><CancelarAssinatura orgId={orgId} /></Cartao> : null}
        </>
      ) : (
        <Cartao icone="relogio" titulo={`${faturas.length} ${faturas.length === 1 ? 'fatura' : 'faturas'}`} subtitulo="As últimas 24 faturas da organização.">
          <TabelaFaturas dados={faturas} />
        </Cartao>
      )}
    </>
  );
}
