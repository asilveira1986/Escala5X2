import Link from 'next/link';
import { Abas } from '@/components/Abas';
import { EstadoVazio } from '@/components/EstadoVazio';
import { lerAba } from '@/lib/abas';
import { Aviso, Cartao, classeBotaoLink, Selo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { horasTexto } from '@/lib/banco-horas-ui';
import { mesVizinho } from '@/lib/carteira';
import { carregarMarcacoes, temMarcacoes } from '@/lib/folha-dados';
import { lerCompetencia, lerOpcoesFolha, mesEncerrado, rotuloMes } from '@/lib/folha-ui';
import { calcularFechamento, carregarBaseFechamento, podeFechar } from '@jc/servicos';
import { dataBr, dataDeInstante } from '@jc/rules-engine';
import { BotaoFechar } from './BotaoFechar';

type FechamentoLinha = { id: string; versao: number; status: 'fechado' | 'substituido'; motivo: string | null; criado_em: string; dados_hash: string };
const moeda = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const tomAviso = { bloqueio: 'erro', alerta: 'info', info: 'info' } as const;

export default async function Folha({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string; origem?: string; sem?: string; aba?: string }> }) {
  const empresaId = idOu404((await params).id);
  const hoje = dataDeInstante(new Date());
  const sp = await searchParams;
  const aba = lerAba(sp.aba, [{ id: 'previa' }, { id: 'fechamentos' }]);
  const { mes, dia } = lerCompetencia(sp.mes, hoje);
  const { supabase } = await exigirUsuario();
  const [{ data: fech }, { data: ger }, calculo] = await Promise.all([
    supabase.from('fechamento_folha').select('id, versao, status, motivo, criado_em, dados_hash').eq('empresa_id', empresaId).eq('competencia', dia).order('versao', { ascending: false }),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
    carregarBaseFechamento(supabase, empresaId, dia).then((r) => ({ ok: true as const, ...r }), (e: unknown) => ({ ok: false as const, erro: e instanceof Error ? e.message : 'erro' })),
  ]);
  const versoes = linhas<FechamentoLinha>(fech);
  const vigente = versoes.find((v) => v.status === 'fechado');
  const podeGerir = ger === true;
  const encerrado = mesEncerrado(mes, hoje);
  const fim = calculo.ok ? calculo.base.fim : dia;
  const { origem, semMarcacao } = lerOpcoesFolha(sp.origem, sp.sem, calculo.ok ? await temMarcacoes(supabase, empresaId, dia, fim) : false);
  const marc = calculo.ok && origem === 'ponto' ? await carregarMarcacoes(supabase, empresaId, dia, fim) : null;
  const f = calculo.ok ? calcularFechamento(calculo.base, calculo.entradas, { origem, marcacoes: marc?.marcacoes ?? [], semMarcacao }) : null;
  const href = (m: string, o = origem, s2 = semMarcacao) => `/empresas/${empresaId}/folha?mes=${m}&origem=${o}&sem=${s2}${aba === 'previa' ? '' : `&aba=${aba}`}`;
  const abas = [{ id: 'previa', rotulo: 'Prévia do mês' }, { id: 'fechamentos', rotulo: 'Fechamento e versões', contagem: versoes.length }];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Abas abas={abas} atual={aba} base={`/empresas/${empresaId}/folha`} extras={{ mes, origem, sem: semMarcacao }} />
        <div className="flex items-center gap-1 text-sm font-semibold">
          <Link href={href(mesVizinho(mes, -1))} aria-label="Mês anterior" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">‹</Link>
          <span className="min-w-40 text-center">{rotuloMes(mes)}</span>
          <Link href={href(mesVizinho(mes, 1))} aria-label="Próximo mês" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">›</Link>
        </div>
      </div>

      {aba === 'fechamentos' ? (
        <>
      {vigente ? (
        <Cartao icone="folha" titulo={`Mês fechado · versão ${vigente.versao}`} subtitulo={`Fechado em ${dataBr(vigente.criado_em.slice(0, 10))}. Código de integridade ${vigente.dados_hash.slice(0, 16)}…`}>
          <div className="flex flex-wrap items-center gap-2">
            <Selo tom="verde">Fechado</Selo>
            <a href={`/api/v1/folha/${vigente.id}?formato=xlsx`} className={classeBotaoLink}>Baixar Excel</a>
            <a href={`/api/v1/folha/${vigente.id}?formato=csv`} className={classeBotaoLink}>Baixar CSV</a>
          </div>
          <p className="mt-2 text-xs text-suave">O arquivo sai do retrato fechado (não muda se a escala ou o banco de horas mudarem depois) e cada download fica registrado.</p>
        </Cartao>
      ) : null}

      {versoes.length > 1 || (versoes.length === 1 && !vigente) ? (
        <Cartao icone="folha" titulo="Versões anteriores">
          <ul className="divide-y divide-linha">
            {versoes.filter((v) => v.status === 'substituido').map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                <span>Versão {v.versao} · {dataBr(v.criado_em.slice(0, 10))}{v.motivo ? ` · ${v.motivo}` : ''} <Selo tom="cinza">substituída</Selo></span>
                <span className="flex gap-2"><a href={`/api/v1/folha/${v.id}?formato=xlsx`} className="font-semibold text-marca hover:underline">Excel</a><a href={`/api/v1/folha/${v.id}?formato=csv`} className="font-semibold text-marca hover:underline">CSV</a></span>
              </li>
            ))}
          </ul>
        </Cartao>
      ) : null}
          {!vigente && versoes.length === 0 ? <Cartao><EstadoVazio titulo="Nenhum fechamento neste mês">Feche o mês na aba Prévia, depois que ele terminar.</EstadoVazio></Cartao> : null}
        </>
      ) : (
        <>
      {calculo.ok ? (
        <Cartao icone="relogio" titulo="De onde vêm as horas" subtitulo="Pela escala são as horas previstas; pelo ponto são as apuradas pelas marcações do relógio importadas em Ponto (AFD).">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Opcoes rotulo="Origem" itens={[{ v: 'escala', t: 'Escala (previstas)', h: href(mes, 'escala') }, { v: 'ponto', t: 'Ponto (apuradas)', h: href(mes, 'ponto') }]} atual={origem} />
            {origem === 'ponto' ? <Opcoes rotulo="Dia sem marcação" itens={[{ v: 'escala', t: 'Contar como previsto', h: href(mes, 'ponto', 'escala') }, { v: 'falta', t: 'Descontar como falta', h: href(mes, 'ponto', 'falta') }]} atual={semMarcacao} /> : null}
          </div>
          {marc && !marc.completo ? <div className="mt-3"><Aviso tipo="erro">Não foi possível ler todas as marcações do mês: o resultado pode estar incompleto. Recarregue a página.</Aviso></div> : null}
        </Cartao>
      ) : null}
      {!calculo.ok ? <Aviso tipo="erro">Não foi possível calcular este mês agora. {/permiss/i.test(calculo.erro) ? 'Você não tem permissão para ver a folha desta empresa.' : 'Tente recarregar a página.'}</Aviso> : null}
      {f ? (
        <>
          {!encerrado ? <Aviso tipo="info">{rotuloMes(mes)} ainda não terminou: os números abaixo são uma prévia e o mês só pode ser fechado depois que acabar.</Aviso> : null}
          {f.avisos.map((a) => <Aviso key={a.codigo} tipo={tomAviso[a.severidade]}>{a.mensagem}</Aviso>)}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Numero rotulo="Colaboradores" valor={String(f.totais.colaboradores)} />
            <Numero rotulo="Horas trabalhadas" valor={horasTexto(f.totais.trabalhadasMin)} />
            <Numero rotulo="Horas extras" valor={horasTexto(f.totais.extrasMin)} />
            <Numero rotulo="Vencido a pagar (banco)" valor={horasTexto(f.totais.bancoVencidoMin)} sub={f.totais.valorVencidoCentavos > 0 ? `≈ ${moeda(f.totais.valorVencidoCentavos)}` : undefined} />
          </div>
          {podeGerir && encerrado ? <BotaoFechar empresaId={empresaId} mes={mes} reabrir={!!vigente} origem={origem} semMarcacao={semMarcacao} podeFechar={podeFechar(f) && (marc?.completo ?? true)} motivoBloqueio={f.avisos.find((a) => a.severidade === 'bloqueio')?.mensagem} /> : null}
          <Cartao icone="folha" titulo={`Prévia: ${rotuloMes(mes)}`} subtitulo={`Calculada ${origem === 'ponto' ? 'pelo ponto apurado' : 'pela escala publicada'} e pelo banco de horas; é o que o fechamento guardaria agora.`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="rotulo-col"><tr><th className="py-1.5 pr-3">Colaborador</th><th className="pr-3">Matrícula</th><th className="pr-3 text-right">Trabalhadas</th><th className="pr-3 text-right">Extras</th><th className="pr-3 text-right">Noturno</th><th className="pr-3 text-right">Faltas</th>{origem === 'ponto' ? <th className="pr-3 text-right">Sem marcação</th> : null}<th className="pr-3 text-right">Férias/afast.</th><th className="pr-3 text-right">Banco</th></tr></thead>
                <tbody className="divide-y divide-linha">
                  {f.linhas.map((l) => (
                    <tr key={l.colaboradorId}>
                      <td className="py-1.5 pr-3 font-semibold">{l.nome}</td>
                      <td className="pr-3">{l.matricula ?? <span className="text-atencao-fg">sem matrícula</span>}</td>
                      <td className="pr-3 text-right">{horasTexto(l.trabalhadasMin)}</td>
                      <td className="pr-3 text-right">{horasTexto(l.extrasMin)}</td>
                      <td className="pr-3 text-right">{horasTexto(l.noturnasComputadasMin)}</td>
                      <td className="pr-3 text-right">{horasTexto(l.faltasMin)}</td>
                      {origem === 'ponto' ? <td className="pr-3 text-right">{l.diasSemMarcacao > 0 ? `${l.diasSemMarcacao} d${l.faltasPontoMin > 0 ? ` (−${horasTexto(l.faltasPontoMin)})` : ''}` : '—'}</td> : null}
                      <td className="pr-3 text-right">{l.diasFerias + l.diasAfastamento} d</td>
                      <td className="pr-3 text-right">{horasTexto(l.bancoSaldoFinalMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </>
      ) : null}

        </>
      )}
    </>
  );
}

function Opcoes({ rotulo, itens, atual }: { rotulo: string; itens: { v: string; t: string; h: string }[]; atual: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold text-suave">{rotulo}</span>
      <div role="group" aria-label={rotulo} className="inline-flex rounded-full border border-linha bg-fundo p-0.5">
        {itens.map((i) => (
          <Link key={i.v} href={i.h} aria-current={i.v === atual ? 'true' : undefined} className={`rounded-full px-3 py-1 font-semibold transition-colors ${i.v === atual ? 'bg-marca text-sobre-marca' : 'text-suave hover:text-tinta'}`}>{i.t}</Link>
        ))}
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-linha bg-cartao px-4 py-2.5">
      <p className="text-xs font-semibold text-suave">{rotulo}</p>
      <p className="text-2xl font-bold">{valor}</p>
      {sub ? <p className="text-xs text-suave">{sub}</p> : null}
    </div>
  );
}
