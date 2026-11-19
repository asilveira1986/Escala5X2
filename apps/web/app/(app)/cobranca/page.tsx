import { Abas } from '@/components/Abas';
import { lerAba } from '@/lib/abas';
import { Aviso, Cartao, Selo } from '@/components/ui';
import { cobrancaAtiva, moeda, provedorDeCobranca, ROTULO_FATURA, ROTULO_FORMA } from '@/lib/cobranca';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { dataBr, dataDeInstante } from '@jc/rules-engine';
import { situacaoDaConta, type FormaPagamento, type StatusAssinatura } from '@jc/servicos';
import { CancelarAssinatura, EscolhaPlano } from './AcoesCobranca';

type Plano = { id: string; codigo: string; nome: string; descricao: string | null; preco_centavos: number; limite_colaboradores: number | null };
type Assin = { id: string; status: StatusAssinatura; plano_id: string | null; teste_ate: string | null; forma: FormaPagamento | null; proximo_vencimento: string | null };
type Fatura = { id: string; valor_centavos: number; vencimento: string; status: keyof typeof ROTULO_FATURA; forma: FormaPagamento | null; url: string | null; pago_em: string | null };
const tomFatura = { pendente: 'amarelo', paga: 'verde', vencida: 'vermelho', estornada: 'cinza', cancelada: 'cinza' } as const;
const ROTULO_STATUS = { teste: 'Em teste', aguardando_pagamento: 'Aguardando pagamento', ativa: 'Ativa', inadimplente: 'Fatura vencida', cancelada: 'Cancelada' } as const;
const tomStatus = { teste: 'azul', aguardando_pagamento: 'amarelo', ativa: 'verde', inadimplente: 'vermelho', cancelada: 'cinza' } as const;

export default async function PaginaCobranca({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const aba = lerAba((await searchParams).aba, [{ id: 'plano' }, { id: 'faturas' }]);
  const { supabase, user } = await exigirUsuario();
  const { data: mem } = await supabase.from('membro').select('organizacao_id, papel, organizacao:organizacao_id(nome)').eq('usuario_id', user.id).eq('papel', 'admin');
  const orgs = linhas<{ organizacao_id: string; organizacao: { nome: string } | null }>(mem);
  if (orgs.length === 0) return <Cartao icone="folha" titulo="Plano e cobrança"><p className="text-sm text-suave">Só o administrador da organização acessa o plano e a cobrança. Peça a ele, ou entre com a conta de administrador.</p></Cartao>;
  const org = orgs[0]!;
  const hoje = dataDeInstante(new Date());
  const [{ data: a }, { data: pl }, { data: fa }, { count }] = await Promise.all([
    supabase.from('assinatura').select('id, status, plano_id, teste_ate, forma, proximo_vencimento').eq('organizacao_id', org.organizacao_id).maybeSingle(),
    supabase.from('plano').select('id, codigo, nome, descricao, preco_centavos, limite_colaboradores').order('ordem'),
    supabase.from('fatura').select('id, valor_centavos, vencimento, status, forma, url, pago_em').eq('organizacao_id', org.organizacao_id).order('vencimento', { ascending: false }).limit(24),
    supabase.from('colaborador').select('id', { count: 'exact', head: true }).eq('organizacao_id', org.organizacao_id).is('desligamento', null),
  ]);
  const assinatura = a as Assin | null;
  const planos = linhas<Plano>(pl), faturas = linhas<Fatura>(fa);
  const atual = planos.find((p) => p.id === assinatura?.plano_id) ?? null;
  const ativos = count ?? 0;
  const sit = assinatura ? situacaoDaConta({ status: assinatura.status, testeAte: assinatura.teste_ate, hoje, vencidaDesde: assinatura.proximo_vencimento, limiteColaboradores: atual?.limite_colaboradores, colaboradoresAtivos: ativos, cobrancaAtiva: cobrancaAtiva() }) : null;
  const emAndamento = !!assinatura && ['ativa', 'aguardando_pagamento', 'inadimplente'].includes(assinatura.status);
  const configurado = provedorDeCobranca() !== null;

  return (
    <>
      {!configurado ? <Aviso>A cobrança ainda não está configurada neste ambiente (faltam as chaves do provedor de pagamento no servidor). Os planos abaixo são só para consulta.</Aviso> : null}
      {sit?.aviso ? <Aviso tipo={sit.aviso.tom === 'risco' ? 'erro' : 'info'}>{sit.aviso.texto}</Aviso> : null}

      <Abas abas={[{ id: 'plano', rotulo: 'Assinatura e planos' }, { id: 'faturas', rotulo: 'Faturas', contagem: faturas.filter((f) => f.status === 'pendente' || f.status === 'vencida').length }]} atual={aba} base="/cobranca" />
      {aba === 'plano' ? (
        <>
      {assinatura ? (
        <Cartao icone="folha" titulo={`Assinatura de ${org.organizacao?.nome ?? 'sua organização'}`} acoes={<Selo tom={tomStatus[assinatura.status]}>{ROTULO_STATUS[assinatura.status]}</Selo>}>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-suave">Plano</dt><dd className="font-semibold">{atual?.nome ?? '—'}{atual ? ` · ${moeda(atual.preco_centavos)}/mês` : ''}</dd></div>
            <div><dt className="text-suave">{assinatura.status === 'teste' ? 'Teste até' : 'Próximo vencimento'}</dt><dd className="font-semibold">{assinatura.status === 'teste' ? (assinatura.teste_ate ? dataBr(assinatura.teste_ate) : '—') : (assinatura.proximo_vencimento ? dataBr(assinatura.proximo_vencimento) : '—')}</dd></div>
            <div><dt className="text-suave">Forma de pagamento</dt><dd className="font-semibold">{assinatura.forma ? ROTULO_FORMA[assinatura.forma] : '—'}</dd></div>
            <div><dt className="text-suave">Colaboradores ativos</dt><dd className={`font-semibold ${sit?.excedeLimite ? 'text-atencao-fg' : ''}`}>{ativos}{atual?.limite_colaboradores ? ` de ${atual.limite_colaboradores}` : ''}</dd></div>
          </dl>
          {emAndamento ? <div className="mt-4 border-t border-linha pt-3"><CancelarAssinatura orgId={org.organizacao_id} /></div> : null}
        </Cartao>
      ) : null}

      <Cartao icone="banco" titulo="Planos" subtitulo="Preço mensal por organização, conforme o número de colaboradores ativos.">
        <ul className="grid gap-3 md:grid-cols-3">
          {planos.map((p) => (
            <li key={p.id} className={`flex flex-col gap-2 rounded-2xl border p-4 ${p.id === atual?.id ? 'border-marca bg-marca-suave/40' : 'border-linha'}`}>
              <h3 className="text-base font-bold">{p.nome}</h3>
              <p className="text-2xl font-bold">{moeda(p.preco_centavos)}<span className="text-sm font-medium text-suave">/mês</span></p>
              <p className="text-sm text-suave">{p.limite_colaboradores ? `Até ${p.limite_colaboradores} colaboradores` : 'Colaboradores ilimitados'}</p>
              {p.descricao ? <p className="text-xs text-suave">{p.descricao}</p> : null}
              <div className="mt-auto pt-2">{configurado ? <EscolhaPlano orgId={org.organizacao_id} planoId={p.id} atual={p.id === atual?.id} emAndamento={emAndamento} rotulo={p.nome} /> : null}</div>
            </li>
          ))}
        </ul>
      </Cartao>

        </>
      ) : (
        <>
      <Cartao icone="relogio" titulo="Faturas">
        {faturas.length === 0 ? <p className="text-sm text-suave">Nenhuma fatura ainda. Depois de assinar, a primeira aparece aqui.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="rotulo-col"><tr><th className="py-1.5 pr-3">Vencimento</th><th className="pr-3 text-right">Valor</th><th className="pr-3">Forma</th><th className="pr-3">Situação</th><th /></tr></thead>
              <tbody className="divide-y divide-linha">
                {faturas.map((f) => (
                  <tr key={f.id}>
                    <td className="py-1.5 pr-3 font-semibold">{dataBr(f.vencimento)}</td>
                    <td className="pr-3 text-right">{moeda(f.valor_centavos)}</td>
                    <td className="pr-3">{f.forma ? ROTULO_FORMA[f.forma] : '—'}</td>
                    <td className="pr-3"><Selo tom={tomFatura[f.status]}>{ROTULO_FATURA[f.status]}</Selo>{f.pago_em ? <span className="ml-2 text-xs text-suave">em {dataBr(f.pago_em.slice(0, 10))}</span> : null}</td>
                    <td className="text-right">{f.url && (f.status === 'pendente' || f.status === 'vencida') ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-marca hover:underline">Pagar</a> : f.url && f.status === 'paga' ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-marca hover:underline">Ver</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
        </>
      )}
    </>
  );
}
