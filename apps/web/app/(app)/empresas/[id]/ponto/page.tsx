import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Aviso, Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { horasTexto } from '@/lib/banco-horas-ui';
import { mesVizinho } from '@/lib/carteira';
import { rotuloMes } from '@/lib/folha-ui';
import { todasAsLinhas } from '@/lib/paginar';
import { carregarEntradaEscala, conciliarPonto, ROTULO_CONCILIACAO, type EntradaEscala, type MarcacaoPonto } from '@jc/servicos';
import { dataBr, dataDeInstante, dataDoNumero, numeroDoDia } from '@jc/rules-engine';
import { FormImportarAfd } from './FormImportarAfd';
import { ListaImportacoes, type ImportacaoVista } from './ListaImportacoes';
import { Pendentes, type Pendente } from './Pendentes';

const LIMITE_DIVERGENCIAS = 200;

export default async function Ponto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const empresaId = idOu404((await params).id);
  const hoje = dataDeInstante(new Date());
  const q = (await searchParams).mes;
  const mes = typeof q === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : hoje.slice(0, 7);
  const inicio = `${mes}-01`;
  const fim = dataDoNumero(numeroDoDia(`${mesVizinho(mes, 1)}-01`) - 1);
  const { supabase } = await exigirUsuario();

  const [{ data: imp }, { data: pend }, { data: col }, { data: ger }, { data: ids }] = await Promise.all([
    supabase.from('afd_importacao').select('id, arquivo_nome, status, criado_em, relatorio').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(20),
    supabase.rpc('identificadores_pendentes', { p_empresa: empresaId }),
    supabase.from('colaborador').select('id, nome, desligamento').eq('empresa_id', empresaId).order('nome').limit(1000),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
    supabase.rpc('escalas_publicadas_no_periodo', { p_empresa: empresaId, p_inicio: inicio, p_fim: fim }),
  ]);
  const importacoes = linhas<ImportacaoVista>(imp);
  const pendentes = linhas<Pendente>(pend);
  const colaboradores = linhas<{ id: string; nome: string; desligamento: string | null }>(col).filter((c) => !c.desligamento);
  const podeGerir = ger === true;

  // Conciliação: escala publicada do mês × marcações vinculadas (um dia a mais nas pontas, por causa de turno que vira a noite)
  const entradas: EntradaEscala[] = [];
  for (const id of Array.isArray(ids) ? (ids as string[]) : []) entradas.push(await carregarEntradaEscala(supabase, id));
  const de = `${dataDoNumero(numeroDoDia(inicio) - 1)}T00:00:00-03:00`, ate = `${dataDoNumero(numeroDoDia(fim) + 2)}T00:00:00-03:00`;
  const marc = entradas.length > 0
    ? await todasAsLinhas<MarcacaoPonto>((a, b) => supabase.from('marcacao_ponto').select('colaborador_id, momento').eq('empresa_id', empresaId).not('colaborador_id', 'is', null).gte('momento', de).lt('momento', ate).order('momento').range(a, b))
    : { linhas: [], truncado: false, erro: false };
  const conc = entradas.map((e) => conciliarPonto({ ...e, escala: { ...e.escala, inicio: e.escala.inicio < inicio ? inicio : e.escala.inicio, fim: e.escala.fim > fim ? fim : e.escala.fim } }, marc.linhas));
  const resumo = conc.flatMap((c) => c.resumo).filter((r) => r.diasPrevistos > 0 || r.apuradoMin > 0);
  const nomes = new Map(resumo.map((r) => [r.colaboradorId, r.nome]));
  const divergencias = conc.flatMap((c) => c.dias).filter((d) => d.codigos.length > 0).sort((a, b) => a.data.localeCompare(b.data) || (nomes.get(a.colaboradorId) ?? '').localeCompare(nomes.get(b.colaboradorId) ?? '', 'pt-BR'));
  const href = (m: string) => `/empresas/${empresaId}/ponto?mes=${m}`;

  return (
    <>
      <Link href={`/empresas/${empresaId}/escalas`} className="inline-flex min-h-9 items-center text-sm font-semibold text-marca hover:underline">← Escalas</Link>
      <Cartao titulo="Importar o ponto (AFD)" subtitulo="Marcações do relógio de ponto. CPF e PIS não ficam guardados: o sistema guarda só um código e os 4 últimos dígitos.">
        {podeGerir ? <FormImportarAfd empresaId={empresaId} /> : <p className="text-sm text-suave">Só quem gere a empresa pode importar o ponto.</p>}
      </Cartao>

      {pendentes.length > 0 ? (
        <Cartao titulo="Identificadores sem colaborador" subtitulo="O relógio mandou marcações de números que o sistema ainda não reconhece (PIS, ou CPF não cadastrado). Vincule uma vez e as próximas importações já reconhecem.">
          {podeGerir ? <Pendentes empresaId={empresaId} pendentes={pendentes} colaboradores={colaboradores.map((c) => ({ id: c.id, nome: c.nome }))} /> : <p className="text-sm text-suave">{pendentes.length} identificador(es) aguardando vínculo pelo RH.</p>}
        </Cartao>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Escala × ponto</h2>
        <div className="flex items-center gap-1 text-sm font-semibold">
          <Link href={href(mesVizinho(mes, -1))} aria-label="Mês anterior" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">‹</Link>
          <span className="min-w-40 text-center">{rotuloMes(mes)}</span>
          <Link href={href(mesVizinho(mes, 1))} aria-label="Próximo mês" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">›</Link>
        </div>
      </div>
      {marc.truncado ? <Aviso tipo="info">Há mais marcações do que a tela consegue conferir de uma vez; os números abaixo estão incompletos.</Aviso> : null}
      {marc.erro ? <Aviso tipo="erro">Não foi possível carregar todas as marcações. Recarregue a página.</Aviso> : null}
      {entradas.length === 0 ? (
        <Cartao><EstadoVazio titulo="Nenhuma escala publicada neste mês">A conferência compara a escala publicada com as marcações do relógio.</EstadoVazio></Cartao>
      ) : (
        <>
          <Aviso tipo="info">A conferência só informa: ela não altera a escala, o banco de horas nem o fechamento. Marcação sem colaborador vinculado não aparece aqui.</Aviso>
          <Cartao titulo={`Resumo por colaborador · ${rotuloMes(mes)}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-semibold uppercase tracking-wide text-suave"><tr><th className="py-1.5 pr-3">Colaborador</th><th className="pr-3 text-right">Previsto</th><th className="pr-3 text-right">Apurado</th><th className="pr-3 text-right">Sem marcação</th><th className="pr-3 text-right">Atrasos</th><th className="pr-3 text-right">Além do turno</th><th className="pr-3 text-right">Dias a conferir</th></tr></thead>
                <tbody className="divide-y divide-linha">
                  {resumo.map((r) => (
                    <tr key={r.colaboradorId}>
                      <td className="py-1.5 pr-3 font-semibold">{r.nome}</td>
                      <td className="pr-3 text-right">{horasTexto(r.previstoMin)}</td><td className="pr-3 text-right">{horasTexto(r.apuradoMin)}</td>
                      <td className={`pr-3 text-right ${r.diasSemMarcacao > 0 ? 'font-semibold text-risco-fg' : ''}`}>{r.diasSemMarcacao} dia(s)</td>
                      <td className="pr-3 text-right">{horasTexto(r.atrasoMin)}</td><td className="pr-3 text-right">{horasTexto(r.horaExtraMin)}</td>
                      <td className={`pr-3 text-right ${r.diasComDivergencia > 0 ? 'font-semibold text-atencao-fg' : ''}`}>{r.diasComDivergencia}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
          <Cartao titulo="Dias a conferir" subtitulo={divergencias.length > LIMITE_DIVERGENCIAS ? `Mostrando os primeiros ${LIMITE_DIVERGENCIAS} de ${divergencias.length}.` : undefined}>
            {divergencias.length === 0 ? <Aviso tipo="ok">Nenhuma divergência entre a escala e o ponto neste mês.</Aviso> : (
              <ul className="divide-y divide-linha">
                {divergencias.slice(0, LIMITE_DIVERGENCIAS).map((d) => (
                  <li key={`${d.colaboradorId}-${d.data}`} className="py-2 text-sm">
                    <span className="font-semibold">{nomes.get(d.colaboradorId) ?? 'Colaborador'}</span> · {dataBr(d.data)}
                    <span className="block text-suave">{d.codigos.map((c) => ROTULO_CONCILIACAO[c]).join(' · ')}{d.marcacoes.length > 0 ? ` — marcações: ${d.marcacoes.join(', ')}` : ''}{d.previstoLiquidoMin > 0 ? ` — previsto ${horasTexto(d.previstoLiquidoMin)}${d.apuradoMin != null ? `, apurado ${horasTexto(d.apuradoMin)}` : ''}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </>
      )}

      <Cartao titulo="Importações">
        {importacoes.length === 0 ? <EstadoVazio titulo="Nenhum arquivo importado">Envie o AFD do relógio de ponto acima.</EstadoVazio> : <ListaImportacoes empresaId={empresaId} importacoes={importacoes} podeGerir={podeGerir} />}
      </Cartao>
    </>
  );
}
