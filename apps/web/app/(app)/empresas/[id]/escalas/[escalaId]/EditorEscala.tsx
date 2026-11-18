'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { resumirHoras, validarEntrada, type EntradaEscala } from '@jc/servicos';
import { dataBr, diaDaSemana, duracao, type Violacao } from '@jc/rules-engine';
import { Aviso, Botao, Cartao, classeBotaoLink, Selo } from '@/components/ui';
import {
  aplicarPincel, ausenciasPorCelula, chave, contarTrabalhando, diasComCoberturaBaixa, diasDoPeriodo, faixaHoras, indexar, NOMES_DIA, repetirPrimeiraSemana, rotuloCelula,
  severidadePorCelula, type Celula, type Modelo, type Pincel,
} from '@/lib/escala-editor';
import { novaVersao, publicar, salvarGrade, type EstadoOtimizacao } from '../actions';
import { PainelOtimizador } from './PainelOtimizador';

const classeSeveridade = { bloqueio: 'ring-2 ring-risco-fg', alerta: 'ring-2 ring-atencao-fg', info: 'ring-1 ring-marca' } as const;
const rotuloSeveridade = { bloqueio: 'Impede a publicação', alerta: 'Atenção', info: 'Informação' } as const;
const tomSeveridade = { bloqueio: 'vermelho', alerta: 'amarelo', info: 'azul' } as const;

export function EditorEscala({ empresaId, entrada, modelos, otimizacao = null }: { empresaId: string; entrada: EntradaEscala; modelos: Modelo[]; otimizacao?: EstadoOtimizacao | null }) {
  const router = useRouter();
  const somenteLeitura = entrada.escala.status !== 'rascunho';
  const [alocs, setAlocs] = useState<Celula[]>(entrada.alocacoes);
  const [revisao, setRevisao] = useState(entrada.escala.revisao);
  const [salvo, setSalvo] = useState(JSON.stringify(entrada.alocacoes));
  const [pincel, setPincel] = useState<Pincel>(modelos[0] ? { tipo: 'modelo', modelo: modelos[0] } : { tipo: 'folga' });
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [li, setLi] = useState(false);
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const [pendente, iniciar] = useTransition();

  const dias = useMemo(() => diasDoPeriodo(entrada.escala.inicio, entrada.escala.fim), [entrada]);
  const sujo = JSON.stringify(alocs) !== salvo;
  const resultado = useMemo(() => validarEntrada(entrada, alocs), [entrada, alocs]);
  const celulas = useMemo(() => indexar(alocs), [alocs]);
  const severidades = useMemo(() => severidadePorCelula(resultado.violacoes), [resultado]);
  const trabalhando = useMemo(() => contarTrabalhando(alocs, dias), [alocs, dias]);
  const ausencias = useMemo(() => ausenciasPorCelula(entrada.ausencias, dias), [entrada, dias]);
  const coberturaBaixa = useMemo(() => diasComCoberturaBaixa(resultado.violacoes), [resultado]);
  const feriados = useMemo(() => new Map(entrada.feriados.map((f) => [f.data, f.nome])), [entrada]);
  const horas = useMemo(() => {
    try { return new Map(resumirHoras(entrada, alocs).map((r) => [r.colaboradorId, r.horas])); } catch { return new Map(); }
  }, [entrada, alocs]);
  const nomes = useMemo(() => new Map(entrada.colaboradores.map((c) => [c.colaboradorId, c.nome])), [entrada]);
  const modeloPorId = useMemo(() => new Map(modelos.map((m) => [m.id, m])), [modelos]);

  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const pintar = (colab: string, data: string) => { if (!somenteLeitura) { setAlocs((a) => aplicarPincel(a, colab, data, pincel)); setConfirmando(false); } };

  const gravar = () => iniciar(async () => {
    setAviso(null);
    const r = await salvarGrade(entrada.escala.id, revisao, alocs);
    if (!r.ok) { setAviso({ tipo: 'erro', texto: r.erro }); return; }
    setRevisao(r.revisao); setSalvo(JSON.stringify(alocs));
    setAviso({ tipo: 'ok', texto: 'Escala salva.' });
  });

  const confirmarPublicacao = () => iniciar(async () => {
    setAviso(null);
    const r = await publicar(entrada.escala.id);
    if (!r.ok) { setAviso({ tipo: 'erro', texto: r.erro }); setConfirmando(false); return; }
    router.refresh();
  });

  const criarNovaVersao = () => iniciar(async () => {
    const r = await novaVersao(entrada.escala.id);
    if (!r.ok) { setAviso({ tipo: 'erro', texto: r.erro }); return; }
    router.push(`/empresas/${empresaId}/escalas/${r.escalaId}`);
  });

  const irPara = (v: Violacao) => {
    if (!v.colaboradorId || !v.data) return;
    const k = chave(v.colaboradorId, v.data);
    setFoco(k);
    document.getElementById(`cel-${k}`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  };

  const lista = mostrarTodas ? resultado.violacoes : resultado.violacoes.slice(0, 12);
  const status = entrada.escala.status;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{entrada.escala.nome} <span className="text-base font-normal text-suave">· versão {entrada.escala.versao}</span></h2>
          <p className="text-sm text-suave">{dataBr(entrada.escala.inicio)} a {dataBr(entrada.escala.fim)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Selo tom={status === 'rascunho' ? 'amarelo' : status === 'publicada' ? 'verde' : 'cinza'}>{status === 'rascunho' ? 'Rascunho' : status === 'publicada' ? 'Publicada' : 'Substituída'}</Selo>
          <span className="flex gap-1" role="group" aria-label="Baixar a escala" title={sujo ? 'Baixa a última versão salva (há alterações não salvas)' : 'Baixa a escala para afixar ou abrir no Excel'}>
            <a href={`/api/v1/escalas/${entrada.escala.id}?formato=pdf`} className={classeBotaoLink}>PDF</a>
            <a href={`/api/v1/escalas/${entrada.escala.id}?formato=xlsx`} className={classeBotaoLink}>Excel</a>
          </span>
          <Link href={`/empresas/${empresaId}/escalas/${entrada.escala.id}/historico`} className={classeBotaoLink}>Histórico</Link>
          {somenteLeitura ? (status === 'publicada' ? <Botao variante="secundario" onClick={criarNovaVersao} disabled={pendente}>Criar nova versão</Botao> : <Botao variante="secundario" onClick={criarNovaVersao} disabled={pendente}>Restaurar esta versão</Botao>) : (
            <>
              <Botao variante="secundario" onClick={() => { setAlocs((a) => repetirPrimeiraSemana(a, entrada.escala.inicio, entrada.escala.fim)); setConfirmando(false); }} disabled={pendente}>Repetir 1ª semana</Botao>
              <Botao variante="secundario" onClick={gravar} disabled={pendente || !sujo}>{pendente ? 'Salvando…' : sujo ? 'Salvar' : 'Salvo'}</Botao>
              <Botao onClick={() => { setConfirmando(true); setLi(false); }} disabled={pendente || sujo || !resultado.podePublicar}>Publicar</Botao>
            </>
          )}
        </div>
      </div>

      {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
      {!somenteLeitura && sujo ? <Aviso tipo="info">Há alterações não salvas. Salve antes de publicar.</Aviso> : null}
      {entrada.semContrato.length > 0 ? (
        <Aviso tipo="info">Sem contrato vigente no período (não aparecem na grade): {entrada.semContrato.map((c) => c.nome).join(', ')}. Cadastre o contrato para escalar.</Aviso>
      ) : null}

      {confirmando ? (
        <Cartao titulo="Publicar esta escala?" subtitulo="Depois de publicada ela não pode mais ser alterada; mudanças viram uma nova versão. Os colaboradores passam a vê-la e confirmam a ciência.">
          <p className="text-sm">{resultado.alertas} alerta(s) e {resultado.infos} informação(ões) ficam registrados junto com a publicação.</p>
          {resultado.alertas > 0 ? (
            <label className="mt-3 flex items-start gap-2 text-sm font-semibold">
              <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} className="mt-0.5 size-5" />
              Li os alertas acima e quero publicar mesmo assim.
            </label>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Botao onClick={confirmarPublicacao} disabled={pendente || (resultado.alertas > 0 && !li)}>{pendente ? 'Publicando…' : 'Confirmar publicação'}</Botao>
            <Botao variante="secundario" onClick={() => setConfirmando(false)} disabled={pendente}>Cancelar</Botao>
          </div>
        </Cartao>
      ) : null}

      {!somenteLeitura ? <PainelOtimizador escalaId={entrada.escala.id} inicial={otimizacao} bloqueado={sujo} onAplicada={() => router.refresh()} /> : null}

      {!somenteLeitura ? (
        <Cartao>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Pincel: o que lançar ao tocar numa célula">
            <span className="text-sm font-semibold">Pincel:</span>
            {modelos.map((m) => {
              const ativo = pincel.tipo === 'modelo' && pincel.modelo.id === m.id;
              return (
                <button key={m.id} type="button" role="radio" aria-checked={ativo} onClick={() => setPincel({ tipo: 'modelo', modelo: m })}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold sm:min-h-9 ${ativo ? 'border-marca bg-marca-suave' : 'border-linha bg-cartao'}`}>
                  <span aria-hidden className="size-3 rounded-full" style={{ background: m.cor }} />{m.nome} <span className="font-normal text-suave">{faixaHoras(m)}</span>
                </button>
              );
            })}
            {([['folga', 'Folga'], ['limpar', 'Apagar']] as const).map(([tipo, rotulo]) => {
              const ativo = pincel.tipo === tipo;
              return (
                <button key={tipo} type="button" role="radio" aria-checked={ativo} onClick={() => setPincel({ tipo })}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold sm:min-h-9 ${ativo ? 'border-marca bg-marca-suave' : 'border-linha bg-cartao'}`}>{rotulo}</button>
              );
            })}
            <Link href={`/empresas/${empresaId}/escalas/cobertura`} className="ml-auto text-sm font-semibold text-marca hover:underline">Cobertura</Link>
            <Link href={`/empresas/${empresaId}/escalas/ausencias`} className="text-sm font-semibold text-marca hover:underline">Férias</Link>
            {modelos.length === 0 ? <Link href={`/empresas/${empresaId}/escalas/turnos`} className="text-sm font-semibold text-marca hover:underline">Cadastre turnos para pintar a grade</Link> : null}
          </div>
        </Cartao>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <Resumo rotulo="Impedem a publicação" valor={resultado.bloqueios} tom={resultado.bloqueios > 0 ? 'vermelho' : 'verde'} />
        <Resumo rotulo="Alertas" valor={resultado.alertas} tom={resultado.alertas > 0 ? 'amarelo' : 'verde'} />
        <Resumo rotulo="Informações" valor={resultado.infos} tom="azul" />
      </div>

      <Cartao className="!p-0">
        <div className="max-h-[70vh] overflow-auto rounded-3xl">
          <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 top-0 z-30 min-w-36 border-b border-linha bg-cartao px-3 py-2 text-left text-sm">Pessoa</th>
                {dias.map((d) => {
                  const dow = diaDaSemana(d);
                  const fer = feriados.get(d);
                  return (
                    <th key={d} scope="col" title={fer ? `${dataBr(d)} · ${fer}` : dataBr(d)}
                      className={`sticky top-0 z-20 min-w-11 border-b border-linha px-0.5 py-1 text-center font-semibold ${fer ? 'bg-atencao-bg text-atencao-fg' : dow === 0 || dow === 6 ? 'bg-neutro-bg' : 'bg-cartao'}`}>
                      <span className="block text-[10px] font-normal uppercase text-suave">{NOMES_DIA[dow]}</span>{d.slice(8)}
                    </th>
                  );
                })}
                <th scope="col" className="sticky right-0 top-0 z-30 min-w-24 border-b border-linha bg-cartao px-2 py-2 text-right text-sm">Horas</th>
              </tr>
            </thead>
            <tbody>
              {entrada.colaboradores.map((c) => {
                const h = horas.get(c.colaboradorId);
                return (
                  <tr key={c.colaboradorId}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-linha bg-cartao px-3 py-1 text-left text-sm font-semibold">
                      <span className="block max-w-40 truncate">{c.nome}</span>
                      <span className="block text-[11px] font-normal text-suave">{c.tipoEscala} · {Math.round(c.jornadaSemanalMin / 60)}h</span>
                    </th>
                    {dias.map((d) => {
                      const k = chave(c.colaboradorId, d);
                      const itens = celulas.get(k) ?? [];
                      const aus = itens.length === 0 ? ausencias.get(k) : undefined;
                      const r = aus ? { curto: aus === 'ferias' ? 'Fér' : 'Afa', longo: aus === 'ferias' ? 'Férias lançadas' : 'Afastamento lançado' } : rotuloCelula(itens);
                      const sev = severidades.get(k);
                      const modelo = itens[0]?.modeloId ? modeloPorId.get(itens[0].modeloId) : undefined;
                      const trabalho = itens.some((i) => i.tipo === 'trabalho');
                      const fundo = trabalho ? '' : itens.length || aus ? 'bg-neutro-bg text-neutro-fg' : '';
                      return (
                        <td key={d} className="border-b border-linha p-0.5">
                          <button id={`cel-${k}`} type="button" onClick={() => pintar(c.colaboradorId, d)} disabled={somenteLeitura}
                            aria-label={`${c.nome}, ${dataBr(d)}: ${r.longo}${sev ? `. ${rotuloSeveridade[sev]}` : ''}`}
                            title={r.longo}
                            style={trabalho ? { background: modelo?.cor ?? '#475569', color: '#fff' } : undefined}
                            className={`flex h-10 w-full min-w-10 items-center justify-center rounded-lg text-[11px] font-semibold disabled:cursor-default sm:h-8 ${fundo} ${sev ? classeSeveridade[sev] : ''} ${foco === k ? 'outline outline-4 outline-offset-1 outline-marca' : ''}`}>
                            {r.curto}
                          </button>
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 border-b border-linha bg-cartao px-2 py-1 text-right text-xs">
                      {h ? <><span className="block font-semibold">{duracao(h.trabalhadasMin)}</span>{h.extrasMin > 0 ? <span className="block text-atencao-fg">+{duracao(h.extrasMin)} extras</span> : null}</> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-cartao px-3 py-1.5 text-left text-xs">Pessoas trabalhando</th>
                {trabalhando.map((n, i) => {
                  const baixa = coberturaBaixa.has(dias[i]!);
                  return <td key={dias[i]} title={baixa ? 'Abaixo da cobertura mínima' : undefined} className={`px-0.5 py-1.5 text-center font-semibold ${baixa ? 'rounded bg-atencao-bg text-atencao-fg' : ''}`}>{n}{baixa ? <span className="sr-only"> (abaixo do mínimo)</span> : null}</td>;
                })}
                <td className="sticky right-0 bg-cartao" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Cartao>

      <Cartao titulo="Avisos da escala" subtitulo="Toque num aviso para ir até a célula.">
        {resultado.violacoes.length === 0 ? <Aviso tipo="ok">Nenhum aviso. {alocs.length === 0 ? 'Comece pintando a grade.' : 'A escala está em conformidade com as regras vigentes.'}</Aviso> : (
          <>
            <ul className="divide-y divide-linha">
              {lista.map((v, i) => (
                <li key={`${v.codigo}-${v.colaboradorId}-${v.data}-${i}`} className="py-2">
                  <button type="button" onClick={() => irPara(v)} className="flex w-full flex-col items-start gap-1 text-left">
                    <span className="flex flex-wrap items-center gap-2"><Selo tom={tomSeveridade[v.severidade]}>{rotuloSeveridade[v.severidade]}</Selo>
                      {v.colaboradorId ? <span className="text-sm font-semibold">{nomes.get(v.colaboradorId) ?? 'Colaborador'}</span> : null}
                      {v.data ? <span className="text-sm text-suave">{dataBr(v.data)}</span> : null}</span>
                    <span className="text-sm">{v.mensagem}</span>
                    {v.sugestao ? <span className="text-sm text-suave">Sugestão: {v.sugestao}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {resultado.violacoes.length > 12 ? (
              <button type="button" onClick={() => setMostrarTodas((x) => !x)} className="mt-2 min-h-9 text-sm font-semibold text-marca hover:underline">
                {mostrarTodas ? 'Mostrar menos' : `Mostrar todos os ${resultado.violacoes.length} avisos`}
              </button>
            ) : null}
          </>
        )}
      </Cartao>
    </div>
  );
}

function Resumo({ rotulo, valor, tom }: { rotulo: string; valor: number; tom: 'verde' | 'amarelo' | 'vermelho' | 'azul' }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-linha bg-cartao px-4 py-2">
      <span className="text-sm font-semibold">{rotulo}</span><Selo tom={tom}>{valor}</Selo>
    </div>
  );
}
