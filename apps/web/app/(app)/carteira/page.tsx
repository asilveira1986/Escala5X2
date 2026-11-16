import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Aviso, Cartao, classeBotaoLink, Selo } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { diasAte, FILTROS, filtrar, lerFiltro, lerMes, mesVizinho, ordenarPorAtencao, pendencias, resumir, type LinhaCarteira } from '@/lib/carteira';
import { lerDaterange } from '@/lib/cobertura';
import { ROTULO_STATUS } from '@/lib/tipos-db';
import { dataBr, dataDeInstante } from '@jc/rules-engine';
import { formatarCnpj } from '@jc/connectors/parsers';

const tomStatus = { nao_iniciado: 'cinza', em_risco: 'amarelo', adequado: 'verde' } as const;
const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const rotuloMes = (m: string) => `${NOMES_MES[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`;

export default async function Carteira({ searchParams }: { searchParams: Promise<{ filtro?: string; mes?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await exigirUsuario();
  const { data: gestao } = await supabase.rpc('minhas_organizacoes_gestao');
  if (!Array.isArray(gestao) || gestao.length === 0) redirect('/empresas'); // painel é só para quem gere empresas
  const hoje = dataDeInstante(new Date());
  const { mes, dia } = lerMes(sp.mes, hoje);
  const filtro = lerFiltro(sp.filtro);
  const [{ data, error }, { data: regra }] = await Promise.all([
    supabase.rpc('painel_carteira', { p_mes: dia }),
    supabase.from('regra_jornada').select('vigencia').eq('codigo', 'EC141_F1').limit(1),
  ]);
  const todas = linhas<LinhaCarteira>(data);
  const resumo = resumir(todas);
  const lista = ordenarPorAtencao(filtrar(todas, filtro));
  const prazo = lerDaterange(linhas<{ vigencia: string }>(regra)[0]?.vigencia ?? '')?.inicio;
  const faltam = prazo ? diasAte(prazo, hoje) : null;
  const href = (f: string, m = mes) => `/carteira?filtro=${f}&mes=${m}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight sm:text-3xl">Carteira</h1>
          <p className="mt-1 text-suave">Suas empresas, das que mais precisam de atenção para as que estão em dia.</p>
        </div>
        <a href={`/api/v1/carteira?mes=${mes}`} className={classeBotaoLink}>Baixar planilha</a>
      </div>

      {faltam != null && prazo ? (
        <Aviso tipo={faltam <= 0 ? 'ok' : faltam <= 45 ? 'erro' : 'info'}>
          {faltam > 0 ? `Faltam ${faltam} dia${faltam === 1 ? '' : 's'} para a 1ª fase da nova jornada (${dataBr(prazo)}).` : `A 1ª fase da nova jornada está em vigor desde ${dataBr(prazo)}.`}
        </Aviso>
      ) : null}
      {error ? <Aviso tipo="erro">Não foi possível carregar a carteira agora. Tente novamente.</Aviso> : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Numero rotulo="Empresas" valor={resumo.empresas} sub={`${resumo.pessoas} pessoas`} />
        <Numero rotulo="Pedem atenção" valor={resumo.atencao} tom={resumo.atencao > 0 ? 'amarelo' : 'verde'} />
        <Numero rotulo="Em risco" valor={resumo.emRisco} tom={resumo.emRisco > 0 ? 'vermelho' : 'verde'} />
        <Numero rotulo="Ciências pendentes" valor={resumo.cienciasPendentes} tom={resumo.cienciasPendentes > 0 ? 'amarelo' : 'verde'} sub={`escala de ${rotuloMes(mes)}`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Filtrar empresas" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <Link key={f.id} href={href(f.id)} aria-current={filtro === f.id ? 'page' : undefined}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${filtro === f.id ? 'border-marca bg-marca text-sobre-marca' : 'border-linha bg-cartao hover:bg-marca-suave'}`}>{f.rotulo}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 text-sm font-semibold" aria-label="Mês das escalas">
          <Link href={href(filtro, mesVizinho(mes, -1))} aria-label="Mês anterior" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">‹</Link>
          <span className="min-w-36 text-center">{rotuloMes(mes)}</span>
          <Link href={href(filtro, mesVizinho(mes, 1))} aria-label="Próximo mês" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">›</Link>
        </div>
      </div>

      {lista.length === 0 ? (
        <Cartao><EstadoVazio titulo={todas.length === 0 ? 'Nenhuma empresa na carteira' : 'Nenhuma empresa neste filtro'}>{todas.length === 0 ? 'Cadastre empresas ou peça o vínculo do escritório às empresas clientes.' : 'Tente outro filtro acima.'}</EstadoVazio></Cartao>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {lista.map((l) => {
            const pend = pendencias(l);
            return (
              <li key={l.empresa_id}>
                <section className="flex h-full flex-col gap-3 rounded-3xl border border-linha bg-cartao p-4 shadow-[0_2px_8px_rgba(16,32,30,0.05)]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-bold" title={l.razao_social}>{l.razao_social}</h2>
                      <p className="text-sm text-suave">{formatarCnpj(l.cnpj)} · {l.uf} · {l.colaboradores} {l.colaboradores === 1 ? 'pessoa' : 'pessoas'}</p>
                    </div>
                    <Selo tom={tomStatus[l.status_adequacao]}>{ROTULO_STATUS[l.status_adequacao]}</Selo>
                  </div>
                  {pend.length === 0 ? <p className="text-sm font-semibold text-ok-fg">Tudo em dia neste mês.</p> : (
                    <ul className="space-y-1">
                      {pend.map((p) => (
                        <li key={p.codigo}>
                          <Link href={`/empresas/${l.empresa_id}/${p.aba}`} className="flex min-h-9 items-center justify-between gap-2 rounded-xl px-2 text-sm hover:bg-marca-suave">
                            <span>{p.texto}</span><span aria-hidden className="text-marca">›</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-auto text-xs text-suave">
                    {l.diagnostico_em ? `Último diagnóstico em ${dataBr(l.diagnostico_em.slice(0, 10))}` : 'Sem diagnóstico'} · {l.escalas_publicadas} publicada(s) e {l.escalas_rascunho} em rascunho em {rotuloMes(mes)}
                  </p>
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Numero({ rotulo, valor, tom, sub }: { rotulo: string; valor: number; tom?: 'verde' | 'amarelo' | 'vermelho'; sub?: string }) {
  return (
    <div className="rounded-2xl border border-linha bg-cartao px-4 py-2.5">
      <p className="text-xs font-semibold text-suave">{rotulo}</p>
      <p className="flex items-center gap-2 text-2xl font-bold">{valor}{tom ? <Selo tom={tom}>{tom === 'verde' ? 'em dia' : tom === 'amarelo' ? 'atenção' : 'risco'}</Selo> : null}</p>
      {sub ? <p className="text-xs text-suave">{sub}</p> : null}
    </div>
  );
}
