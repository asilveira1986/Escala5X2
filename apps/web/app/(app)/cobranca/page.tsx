import { Cartao } from '@/components/ui';
import { lerAba } from '@/lib/abas';
import { cobrancaAtiva, moeda, provedorDeCobranca, ROTULO_FATURA, ROTULO_FORMA } from '@/lib/cobranca';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { dataBr, dataDeInstante } from '@jc/rules-engine';
import { situacaoDaConta, type FormaPagamento } from '@jc/servicos';
import { ABAS_COBRANCA, TelaCobranca, type Assinatura, type Plano } from './TelaCobranca';
import type { LinhaFatura } from './TabelaFaturas';

type Fatura = { id: string; valor_centavos: number; vencimento: string; status: keyof typeof ROTULO_FATURA; forma: FormaPagamento | null; url: string | null; pago_em: string | null };

export default async function PaginaCobranca({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const aba = lerAba((await searchParams).aba, ABAS_COBRANCA);
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
  const assinatura = a as Assinatura | null;
  const planos = linhas<Plano>(pl), faturas = linhas<Fatura>(fa);
  const atual = planos.find((p) => p.id === assinatura?.plano_id) ?? null;
  const ativos = count ?? 0;
  const sit = assinatura ? situacaoDaConta({ status: assinatura.status, testeAte: assinatura.teste_ate, hoje, vencidaDesde: assinatura.proximo_vencimento, limiteColaboradores: atual?.limite_colaboradores, colaboradoresAtivos: ativos, cobrancaAtiva: cobrancaAtiva() }) : null;
  const linhasFatura: LinhaFatura[] = faturas.map((f) => ({
    id: f.id, vencimento: dataBr(f.vencimento), valor: moeda(f.valor_centavos), forma: f.forma ? ROTULO_FORMA[f.forma] : '—', status: f.status, pagoEm: f.pago_em ? dataBr(f.pago_em.slice(0, 10)) : null, url: f.url,
  }));
  return (
    <TelaCobranca orgId={org.organizacao_id} orgNome={org.organizacao?.nome ?? 'sua organização'} assinatura={assinatura} planos={planos} faturas={linhasFatura} ativos={ativos}
      excedeLimite={!!sit?.excedeLimite} aviso={sit?.aviso ?? null} configurado={provedorDeCobranca() !== null} aba={aba} />
  );
}
