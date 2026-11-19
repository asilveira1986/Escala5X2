import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao, Metrica, Selo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { diffEscalas } from '@/lib/escala-diff';
import { carregarEntradaEscala } from '@jc/servicos';
import { dataBr } from '@jc/rules-engine';

type Versao = { id: string; nome: string; status: 'rascunho' | 'publicada' | 'substituida'; versao: number; revisao: number; criado_em: string; publicada_em: string | null; publicada_por: string | null; hash_publicado: string | null };
const ROTULO = { rascunho: 'Rascunho', publicada: 'Publicada', substituida: 'Substituída' } as const;
const TOM = { rascunho: 'amarelo', publicada: 'verde', substituida: 'cinza' } as const;
const MAX_LISTA = 150;
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '—');

/** Versões da mesma escala (mesma empresa, setor e período) e o que mudou de uma para outra. */
export default async function HistoricoEscala({ params, searchParams }: { params: Promise<{ id: string; escalaId: string }>; searchParams: Promise<{ de?: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), escalaId = idOu404(p.escalaId);
  const sp = await searchParams;
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

  return (
    <>
      <Link href={`${href}/${escalaId}`} className="inline-flex min-h-9 items-center text-sm font-semibold text-marca hover:underline">← Voltar à escala</Link>
      <Cartao icone="calendario" titulo={`Histórico de ${atual.escala.nome}`} subtitulo={`${dataBr(atual.escala.inicio)} a ${dataBr(atual.escala.fim)} · uma publicação nova nunca apaga a anterior: ela fica guardada como substituída.`}>
        {versoes.length === 0 ? <EstadoVazio titulo="Sem versões">Nada para mostrar.</EstadoVazio> : (
          <ul className="divide-y divide-linha" aria-label="Versões">
            {versoes.map((v) => (
              <li key={v.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 ${v.id === escalaId ? 'font-semibold' : ''}`}>
                <span className="min-w-[8rem]">{v.status === 'rascunho' ? 'Rascunho' : `Versão ${v.versao}`}{v.id === escalaId ? <span className="ml-2 rounded-full bg-marca-suave px-2 py-0.5 text-[10px] font-bold uppercase text-marca">esta</span> : null}</span>
                <Selo tom={TOM[v.status]}>{ROTULO[v.status]}</Selo>
                <span className="text-sm font-normal text-suave">{v.publicada_em ? `publicada em ${quando(v.publicada_em)}${v.publicada_por && nomeDe.get(v.publicada_por) ? ` por ${nomeDe.get(v.publicada_por)}` : ''}` : `criada em ${quando(v.criado_em)}`}</span>
                {v.hash_publicado ? <span className="font-mono text-xs font-normal text-suave" title="Código de integridade da publicação">{v.hash_publicado.slice(0, 12)}…</span> : null}
                <span className="ml-auto flex gap-3 text-sm font-semibold">
                  {v.id !== escalaId ? <Link className="text-marca hover:underline" href={`${href}/${escalaId}/historico?de=${v.id}`}>Comparar com esta</Link> : null}
                  <Link className="text-marca hover:underline" href={`${href}/${v.id}`}>Abrir</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao icone="diagnostico" titulo="O que mudou" subtitulo={baseVersao ? `${baseVersao.status === 'rascunho' ? 'Rascunho' : `Versão ${baseVersao.versao}`} → ${atual.escala.status === 'rascunho' ? 'Rascunho' : `Versão ${atual.escala.versao}`} (esta)` : undefined}>
        {!diff ? <EstadoVazio titulo="Nada para comparar">Esta é a primeira versão. Quando houver outra, as diferenças aparecem aqui.</EstadoVazio> : diff.mudancas.length === 0 ? <p className="text-sm text-ok-fg">As duas versões são idênticas.</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metrica icone="pessoas" rotulo="Pessoas afetadas" valor={diff.pessoas} />
              <Metrica icone="calendario" rotulo="Dias alterados" valor={diff.dias} />
              <Metrica icone="escalas" tom="verde" rotulo="Passaram a trabalhar" valor={diff.entraramEmTrabalho} />
              <Metrica icone="ferias" tom="ambar" rotulo="Passaram a folgar" valor={diff.sairamDeTrabalho} texto={diff.horarioMudou > 0 ? `${diff.horarioMudou} com horário diferente` : undefined} />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm" aria-label="Diferenças entre as versões">
                <thead className="rotulo-col"><tr><th className="pb-1.5 pr-3">Dia</th><th className="pb-1.5 pr-3">Colaborador</th><th className="pb-1.5 pr-3">Antes</th><th className="pb-1.5">Depois</th></tr></thead>
                <tbody className="divide-y divide-linha">
                  {diff.mudancas.slice(0, MAX_LISTA).map((m) => (
                    <tr key={`${m.colaboradorId}${m.data}`}>
                      <td className="whitespace-nowrap py-1.5 pr-3">{dataBr(m.data)}</td><td className="py-1.5 pr-3 font-semibold">{nomes.get(m.colaboradorId) ?? 'Colaborador'}</td>
                      <td className="py-1.5 pr-3 text-suave">{m.antes ?? '—'}</td><td className="py-1.5">{m.depois ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {diff.mudancas.length > MAX_LISTA ? <p className="mt-2 text-xs text-suave">Mostrando as primeiras {MAX_LISTA} de {diff.mudancas.length} mudanças.</p> : null}
          </>
        )}
      </Cartao>
    </>
  );
}
