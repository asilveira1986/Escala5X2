import { notFound } from 'next/navigation';
import { lerAba } from '@/lib/abas';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { diffEscalas } from '@/lib/escala-diff';
import { carregarEntradaEscala } from '@jc/servicos';
import { dataBr } from '@jc/rules-engine';
import { ABAS_HISTORICO, TelaHistorico } from './TelaHistorico';
import type { LinhaVersao } from './TabelaVersoes';

type Versao = { id: string; nome: string; status: 'rascunho' | 'publicada' | 'substituida'; versao: number; revisao: number; criado_em: string; publicada_em: string | null; publicada_por: string | null; hash_publicado: string | null };
const MAX_LISTA = 150;
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '—');

/** Versões da mesma escala (mesma empresa, setor e período) e o que mudou de uma para outra. */
export default async function HistoricoEscala({ params, searchParams }: { params: Promise<{ id: string; escalaId: string }>; searchParams: Promise<{ de?: string; aba?: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), escalaId = idOu404(p.escalaId);
  const sp = await searchParams;
  const aba = lerAba(sp.aba, ABAS_HISTORICO);
  const { supabase } = await exigirUsuario();
  let atual;
  try { atual = await carregarEntradaEscala(supabase, escalaId); } catch { notFound(); }
  if (atual.escala.empresaId !== empresaId) notFound();
  const fimExclusivo = new Date(Date.parse(`${atual.escala.fim}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  let q = supabase.from('escala').select('id, nome, status, versao, revisao, criado_em, publicada_em, publicada_por, hash_publicado').eq('empresa_id', empresaId).eq('periodo', `[${atual.escala.inicio},${fimExclusivo})`);
  q = atual.escala.setorId ? q.eq('setor_id', atual.escala.setorId) : q.is('setor_id', null);
  const { data } = await q.order('criado_em', { ascending: false }).limit(50);
  const versoes = linhas<Versao>(data);
  const ids = [...new Set(versoes.map((v) => v.publicada_por).filter((x): x is string => !!x))];
  const { data: us } = ids.length > 0 ? await supabase.from('usuario').select('id, nome').in('id', ids) : { data: [] };
  const nomeDe = new Map(linhas<{ id: string; nome: string }>(us).map((u) => [u.id, u.nome]));

  // base da comparação: a escolhida na URL; senão, a versão publicada imediatamente anterior à atual
  const anteriores = versoes.filter((v) => v.id !== escalaId && v.status !== 'rascunho' && (atual.escala.status === 'rascunho' || v.versao < atual.escala.versao));
  const baseId = versoes.some((v) => v.id === sp.de && v.id !== escalaId) ? sp.de! : (anteriores.sort((a, b) => b.versao - a.versao)[0]?.id ?? null);
  const base = baseId ? await carregarEntradaEscala(supabase, baseId).catch(() => null) : null;
  const nomes = new Map([...(base?.colaboradores ?? []), ...atual.colaboradores].map((c) => [c.colaboradorId, c.nome]));
  const diff = base ? diffEscalas(base.alocacoes, atual.alocacoes) : null;
  const baseVersao = versoes.find((v) => v.id === baseId);
  const href = `/empresas/${empresaId}/escalas`;
  const rotuloVersao = (v: { status: string; versao: number }) => (v.status === 'rascunho' ? 'Rascunho' : `Versão ${v.versao}`);
  const linhasVersao: LinhaVersao[] = versoes.map((v) => ({
    id: v.id, rotulo: rotuloVersao(v), status: v.status, atual: v.id === escalaId, hash: v.hash_publicado ? v.hash_publicado.slice(0, 12) : null,
    publicacao: v.publicada_em ? `publicada em ${quando(v.publicada_em)}${v.publicada_por && nomeDe.get(v.publicada_por) ? ` por ${nomeDe.get(v.publicada_por)}` : ''}` : `criada em ${quando(v.criado_em)}`,
    hrefAbrir: `${href}/${v.id}`, hrefComparar: v.id !== escalaId ? `${href}/${escalaId}/historico?aba=mudancas&de=${v.id}` : null,
  }));
  const mudancas = (diff?.mudancas ?? []).slice(0, MAX_LISTA).map((m) => ({ chave: `${m.colaboradorId}${m.data}`, data: dataBr(m.data), pessoa: nomes.get(m.colaboradorId) ?? 'Colaborador', antes: m.antes ?? '—', depois: m.depois ?? '—' }));

  return (
    <TelaHistorico empresaId={empresaId} escalaId={escalaId} nome={atual.escala.nome} periodo={`${dataBr(atual.escala.inicio)} a ${dataBr(atual.escala.fim)}`} aba={aba} versoes={linhasVersao}
      deRotulo={baseVersao ? rotuloVersao(baseVersao) : null} paraRotulo={rotuloVersao({ status: atual.escala.status, versao: atual.escala.versao })} mudancas={mudancas} base={baseVersao?.id}
      diff={diff ? { pessoas: diff.pessoas, dias: diff.dias, entraramEmTrabalho: diff.entraramEmTrabalho, sairamDeTrabalho: diff.sairamDeTrabalho, horarioMudou: diff.horarioMudou, total: diff.mudancas.length } : null} />
  );
}
