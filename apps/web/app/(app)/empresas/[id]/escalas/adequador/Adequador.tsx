'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { Aviso, Botao, Campo, Cartao, classeCampo, Metrica } from '@/components/ui';
import { balancoDaEquipe, CORES_TURNO, DIAS_TELA, frasePessoas, FUNCIONAMENTO_PADRAO, horasTexto, inicialDoTurno, liquidoDoTurno, sugerirCobertura, type TurnoBase } from '@/lib/adequador-ui';
import { dataBr, diaDaSemana } from '@jc/rules-engine';
import { gerarEscalas, type DadosSetor, type ResultadoGeracao } from './actions';

export type ModeloBase = { id: string; nome: string; inicio: string; fim: string; intervalo: number };
type Pessoa = { id: string; nome: string };
type SetorProp = { id: string; nome: string; pessoas: Pessoa[] };
type Ausencia = { colaboradorId: string; inicio: string; fim: string; tipo: 'ferias' | 'afastamento' };
type Props = { empresaId: string; mesPadrao: string; modelos: ModeloBase[]; setores: SetorProp[]; semSetor: number; todos: Pessoa[]; ausencias: Ausencia[] };

const DIAS_OPCOES = [{ v: '', t: 'O que a lei permite (padrão)' }, { v: '5', t: '5 dias (escala 5x2)' }, { v: '6', t: '6 dias (escala 6x1)' }, { v: '4', t: '4 dias' }];
let seq = 0;
const novaChave = () => `t${++seq}`;
const CHAVE_TODOS = '__todos__';

function turnosIniciais(modelos: ModeloBase[]): TurnoBase[] {
  const base = modelos.length > 0 ? modelos.slice(0, 4) : [{ id: '', nome: 'Turno 1', inicio: '08:00', fim: '17:00', intervalo: 60 }];
  return base.map((m) => ({ chave: novaChave(), nome: m.nome, inicio: m.inicio, fim: m.fim, intervalo: m.intervalo, modeloId: m.id || null }));
}
/** Primeiro e último dia (AAAA-MM-DD) do mês AAAA-MM. */
const limitesMes = (mes: string) => { const [a, m] = mes.split('-').map(Number) as [number, number]; return { ini: `${mes}-01`, fim: `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}` }; };

/**
 * "Gerar escala": a gestão informa o mês, os dias de funcionamento, os turnos, quantas pessoas cada setor precisa em cada turno e dia,
 * as folgas fixas e vê as férias; o sistema aloca cada setor e grava um rascunho por setor.
 */
export function GerarEscala({ empresaId, mesPadrao, modelos, setores, semSetor, todos, ausencias }: Props) {
  const grupos: SetorProp[] = useMemo(() => (setores.length > 0 ? setores : [{ id: CHAVE_TODOS, nome: 'Empresa toda', pessoas: todos }]), [setores, todos]);
  const [mes, setMes] = useState(mesPadrao);
  const [dias, setDias] = useState('');
  const [funcionamento, setFuncionamento] = useState<boolean[]>(FUNCIONAMENTO_PADRAO);
  const [fecharFeriados, setFecharFeriados] = useState(false);
  const [turnos, setTurnos] = useState<TurnoBase[]>(() => turnosIniciais(modelos));
  const [incluidos, setIncluidos] = useState<Set<string>>(() => new Set(grupos.filter((g) => g.pessoas.length > 0).map((g) => g.id)));
  const [minimos, setMinimos] = useState<Record<string, Record<string, number[]>>>({});
  const [folgasFixas, setFolgasFixas] = useState<Record<string, number[]>>({});
  const [resultado, setResultado] = useState<ResultadoGeracao | null>(null);
  const [pendente, iniciar] = useTransition();
  const diasNum = dias ? Number(dias) : 5;
  const originais = useMemo(() => new Map(modelos.map((m) => [m.id, m])), [modelos]);
  const { ini: mesIni, fim: mesFim } = limitesMes(mes);

  const minimoDe = (setor: string, turno: string): number[] => minimos[setor]?.[turno] ?? sugerirCobertura(grupos.find((g) => g.id === setor)?.pessoas.length ?? 0, turnos.length, diasNum).map((v, d) => (funcionamento[d] ? v : 0));
  const definirMinimo = (setor: string, turno: string, indice: number, valor: string) => setMinimos((m) => {
    const atual = minimoDe(setor, turno);
    const novo = atual.map((v, i) => (i === indice ? Math.max(0, Math.min(500, Math.floor(Number(valor) || 0))) : v));
    return { ...m, [setor]: { ...(m[setor] ?? {}), [turno]: novo } };
  });
  const sugerir = (setor: string) => setMinimos((m) => {
    const g = grupos.find((x) => x.id === setor)!;
    const base = sugerirCobertura(g.pessoas.length, turnos.length, diasNum);
    return { ...m, [setor]: Object.fromEntries(turnos.map((t) => [t.chave, base.map((v, d) => (funcionamento[d] ? v : 0))])) };
  });
  const copiarPara = (de: string) => setMinimos((m) => ({ ...m, ...Object.fromEntries(grupos.filter((g) => g.id !== de && incluidos.has(g.id)).map((g) => [g.id, Object.fromEntries(turnos.map((t) => [t.chave, [...minimoDe(de, t.chave)]]))])) }));

  const alterarTurno = (chave: string, f: Partial<TurnoBase>) => setTurnos((l) => l.map((t) => {
    if (t.chave !== chave) return t;
    const novo = { ...t, ...f };
    const o = t.modeloId ? originais.get(t.modeloId) : null;
    // mudou o horário de um turno cadastrado: vira um turno só desta geração (o cadastro não é alterado)
    if (o && (novo.inicio !== o.inicio || novo.fim !== o.fim || novo.intervalo !== o.intervalo)) novo.modeloId = null;
    return novo;
  }));
  const adicionarTurno = () => setTurnos((l) => (l.length >= 6 ? l : [...l, { chave: novaChave(), nome: `Turno ${l.length + 1}`, inicio: '14:00', fim: '23:00', intervalo: 60, modeloId: null }]));
  const removerTurno = (chave: string) => setTurnos((l) => (l.length <= 1 ? l : l.filter((t) => t.chave !== chave)));
  const alternarDia = (d: number) => setFuncionamento((f) => f.map((v, i) => (i === d ? !v : v)));
  const alternarFolga = (pessoa: string, d: number) => setFolgasFixas((f) => {
    const atual = f[pessoa] ?? [];
    const novo = atual.includes(d) ? atual.filter((x) => x !== d) : atual.length >= 3 ? atual : [...atual, d];
    return { ...f, [pessoa]: novo };
  });
  const alternarSetor = (id: string) => setIncluidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const invalido = turnos.some((t) => liquidoDoTurno(t) === null || !t.nome.trim());
  const escolhidos = grupos.filter((g) => incluidos.has(g.id) && g.pessoas.length > 0);
  const semCobertura = escolhidos.every((g) => turnos.every((t) => minimoDe(g.id, t.chave).every((m, d) => m === 0 || !funcionamento[d])));
  const abertos = funcionamento.filter(Boolean).length;

  const gerar = () => iniciar(async () => {
    setResultado(null);
    const pessoasEscolhidas = new Set(escolhidos.flatMap((g) => g.pessoas.map((p) => p.id)));
    const r = await gerarEscalas({
      empresaId, mes, diasPorSemana: dias ? Number(dias) : null, funcionamento, fecharNosFeriados: fecharFeriados,
      turnos: turnos.map((t) => ({ chave: t.chave, nome: t.nome, inicio: t.inicio, fim: t.fim, intervalo: t.intervalo, modeloId: t.modeloId })),
      setores: escolhidos.map((g) => ({ setorId: g.id === CHAVE_TODOS ? null : g.id, nome: g.nome, minimos: Object.fromEntries(turnos.map((t) => [t.chave, minimoDe(g.id, t.chave)])) })),
      folgasFixas: Object.fromEntries(Object.entries(folgasFixas).filter(([p, d]) => d.length > 0 && pessoasEscolhidas.has(p))),
    });
    setResultado(r);
  });

  return (
    <div className="space-y-4">
      <Cartao icone="escalas" titulo="1. Período e funcionamento" subtitulo="O mês, quantos dias cada pessoa trabalha por semana e em quais dias a empresa funciona.">
        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Mês"><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} required className={classeCampo} /></Campo>
          <Campo rotulo="Dias de trabalho por semana"><select value={dias} onChange={(e) => setDias(e.target.value)} className={classeCampo}>{DIAS_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}</select></Campo>
        </div>
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Dias de funcionamento</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DIAS_TELA.map((d) => (
              <label key={d.indice} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm font-semibold ${funcionamento[d.indice] ? 'border-marca bg-marca-suave text-marca' : 'border-linha text-suave'}`}>
                <input type="checkbox" className="sr-only" checked={funcionamento[d.indice]} onChange={() => alternarDia(d.indice)} aria-label={`Funciona na ${d.rotulo}`} />{d.rotulo}
              </label>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={fecharFeriados} onChange={(e) => setFecharFeriados(e.target.checked)} />Não funciona nos feriados (ninguém é escalado)</label>
          <p className="mt-1 text-xs text-suave">Dia fechado = folga de todos. {abertos === 0 ? 'Marque pelo menos um dia.' : `${abertos} dia(s) por semana abertos.`}</p>
        </fieldset>
      </Cartao>

      <Cartao icone="turnos" titulo="2. Turnos" subtitulo="Os horários de cada turno. Mudar um turno cadastrado vale só para esta geração; o cadastro não muda."
        acoes={turnos.length < 6 ? <Botao variante="secundario" onClick={adicionarTurno}>Adicionar turno</Botao> : null}>
        <div className="space-y-2">
          {turnos.map((t, ti) => {
            const liq = liquidoDoTurno(t);
            return (
              <div key={t.chave} className="flex flex-wrap items-end gap-3 rounded-2xl border border-linha p-3">
                <span aria-hidden className={`mb-1 grid size-9 place-items-center rounded-xl text-sm font-bold ${CORES_TURNO[ti % CORES_TURNO.length]}`}>{inicialDoTurno(t.nome, ti)}</span>
                <Campo rotulo="Turno"><input value={t.nome} maxLength={40} onChange={(e) => alterarTurno(t.chave, { nome: e.target.value })} className={`${classeCampo} w-36`} /></Campo>
                <Campo rotulo="Entrada"><input type="time" value={t.inicio} onChange={(e) => alterarTurno(t.chave, { inicio: e.target.value })} className={`${classeCampo} w-28`} /></Campo>
                <Campo rotulo="Saída"><input type="time" value={t.fim} onChange={(e) => alterarTurno(t.chave, { fim: e.target.value })} className={`${classeCampo} w-28`} /></Campo>
                <Campo rotulo="Intervalo (min)"><input type="number" min={0} max={240} step={5} value={t.intervalo} onChange={(e) => alterarTurno(t.chave, { intervalo: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })} className={`${classeCampo} w-24`} /></Campo>
                <p className="mb-2 text-sm font-semibold">{liq === null ? <span className="text-risco-fg">horário inválido</span> : <>{horasTexto(liq)} líquidas · {horasTexto(liq * diasNum)}/semana</>}</p>
                {turnos.length > 1 ? <button type="button" onClick={() => removerTurno(t.chave)} aria-label={`Remover o turno ${t.nome}`} className="mb-1 ml-auto rounded-full px-3 py-1.5 text-sm font-semibold text-risco-fg hover:bg-risco-bg">Remover</button> : null}
              </div>
            );
          })}
        </div>
      </Cartao>

      <Cartao icone="pessoas" titulo="3. Setores e pessoas necessárias" subtitulo="Para cada setor, quantas pessoas precisam estar em cada turno em cada dia. O sistema aloca a equipe do setor para completar o time nesses momentos.">
        {semSetor > 0 ? <div className="mb-3"><Aviso>{semSetor} pessoa(s) sem setor ficam de fora. Defina o setor em <strong>Equipe › Colaboradores › Editar</strong>.</Aviso></div> : null}
        <div className="space-y-3">
          {grupos.map((g) => {
            const on = incluidos.has(g.id);
            const b = balancoDaEquipe(turnos.map((t) => ({ minimo: minimoDe(g.id, t.chave).map((m, d) => (funcionamento[d] ? m : 0)) })), g.pessoas.length, diasNum);
            return (
              <section key={g.id} className={`rounded-2xl border p-3 ${on ? 'border-linha' : 'border-linha opacity-60'}`} aria-label={`Setor ${g.nome}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="size-4" checked={on} disabled={g.pessoas.length === 0} onChange={() => alternarSetor(g.id)} aria-label={`Gerar a escala do setor ${g.nome}`} />{g.nome}</label>
                  <span className="text-sm text-suave">{g.pessoas.length} pessoa{g.pessoas.length === 1 ? '' : 's'}{g.pessoas.length === 0 ? ' · cadastre a equipe para gerar' : ''}</span>
                  {on && g.pessoas.length > 0 ? <span className="ml-auto flex gap-1"><Botao variante="secundario" onClick={() => sugerir(g.id)}>Sugerir</Botao>{grupos.filter((x) => incluidos.has(x.id)).length > 1 ? <Botao variante="secundario" onClick={() => copiarPara(g.id)}>Copiar para os outros</Botao> : null}</span> : null}
                </div>
                {on && g.pessoas.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="text-center text-xs">
                      <thead><tr><th className="pr-3 text-left font-semibold text-suave">Turno</th>{DIAS_TELA.map((d) => <th key={d.indice} className={`px-1 font-semibold ${funcionamento[d.indice] ? 'text-suave' : 'text-suave/50'}`}>{d.rotulo}</th>)}</tr></thead>
                      <tbody>
                        {turnos.map((t, ti) => (
                          <tr key={t.chave}>
                            <th scope="row" className="whitespace-nowrap pr-3 text-left text-sm"><span className={`mr-1.5 inline-grid size-5 place-items-center rounded-md text-[11px] font-bold ${CORES_TURNO[ti % CORES_TURNO.length]}`}>{inicialDoTurno(t.nome, ti)}</span>{t.nome}</th>
                            {DIAS_TELA.map((d) => (
                              <td key={d.indice} className="p-0.5">
                                <input type="number" min={0} max={500} disabled={!funcionamento[d.indice]} value={funcionamento[d.indice] ? minimoDe(g.id, t.chave)[d.indice] : 0} onChange={(e) => definirMinimo(g.id, t.chave, d.indice, e.target.value)}
                                  aria-label={`${g.nome}, ${t.nome}: pessoas na ${d.rotulo}`} className={`${classeCampo} !mt-0 !min-h-9 !w-14 text-center ${funcionamento[d.indice] ? '' : 'bg-fundo'}`} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className={`mt-1.5 text-xs ${b.sobra < 0 ? 'font-semibold text-atencao-fg' : 'text-suave'}`}>{frasePessoas(b, g.pessoas.length, diasNum)}</p>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </Cartao>

      <Cartao icone="ferias" titulo="4. Folgas e férias" subtitulo="Folga fixa: dia da semana em que a pessoa não trabalha (até 3). Férias e afastamentos cadastrados já entram e a equipe cobre sem a pessoa.">
        {escolhidos.length === 0 ? <p className="text-sm text-suave">Escolha ao menos um setor com pessoas.</p> : (
          <div className="space-y-4">
            {escolhidos.map((g) => (
              <div key={g.id}>
                {grupos.length > 1 || setores.length > 0 ? <h3 className="mb-1 text-sm font-bold">{g.nome}</h3> : null}
                <ul className="divide-y divide-linha">
                  {g.pessoas.map((p) => {
                    const fer = ausencias.filter((a) => a.colaboradorId === p.id && a.inicio <= mesFim && a.fim >= mesIni);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2">
                        <span className="min-w-40 font-semibold">{p.nome}</span>
                        <span role="group" aria-label={`Folga fixa de ${p.nome}`} className="flex flex-wrap gap-1">
                          {DIAS_TELA.map((d) => {
                            const marcado = (folgasFixas[p.id] ?? []).includes(d.indice);
                            return <button type="button" key={d.indice} aria-pressed={marcado} aria-label={`${p.nome}: folga fixa na ${d.rotulo}`} onClick={() => alternarFolga(p.id, d.indice)} className={`min-h-8 rounded-full border px-2.5 text-xs font-semibold ${marcado ? 'border-violeta-fg bg-violeta-bg text-violeta-fg' : 'border-linha text-suave hover:bg-fundo'}`}>{d.rotulo}</button>;
                          })}
                        </span>
                        {fer.map((a) => <span key={`${a.inicio}${a.tipo}`} className="rounded-full bg-violeta-bg px-2.5 py-0.5 text-xs font-semibold text-violeta-fg">{a.tipo === 'ferias' ? 'Férias' : 'Afastamento'} {dataBr(a.inicio).slice(0, 5)}–{dataBr(a.fim).slice(0, 5)}</span>)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <p className="text-xs text-suave">Precisa lançar férias ou afastamento? Faça em <Link href={`/empresas/${empresaId}/escalas/ausencias`} className="font-semibold text-marca hover:underline">Férias e afastamentos</Link> e volte aqui.</p>
          </div>
        )}
      </Cartao>

      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={gerar} disabled={pendente || invalido || semCobertura || escolhidos.length === 0 || abertos === 0}>{pendente ? 'Gerando a escala…' : `Gerar escala${escolhidos.length > 1 ? ` dos ${escolhidos.length} setores` : ''}`}</Botao>
        {escolhidos.length === 0 ? <span className="text-sm text-risco-fg">Nenhum setor com pessoas escolhido: cadastre a equipe e escolha o setor.</span>
          : abertos === 0 ? <span className="text-sm text-risco-fg">Marque os dias de funcionamento.</span>
          : invalido ? <span className="text-sm text-risco-fg">Confira os horários dos turnos.</span>
          : semCobertura ? <span className="text-sm text-suave">Informe quantas pessoas cada turno precisa em pelo menos um dia aberto.</span>
          : <span className="text-sm text-suave">Cria (ou atualiza) um rascunho “Adequação {mes}” por setor. Nada é publicado.</span>}
      </div>

      {resultado && !resultado.ok ? <Aviso tipo="erro">{resultado.erro}</Aviso> : null}
      {resultado && resultado.ok ? (
        <div className="space-y-8">
          {resultado.setores.map((s) => (
            <section key={s.setorId ?? CHAVE_TODOS} aria-label={`Resultado: ${s.setorNome}`} className="space-y-3">
              {resultado.setores.length > 1 || s.setorId ? <h2 className="text-lg font-bold">{s.setorNome}</h2> : null}
              {s.ok ? <ResultadoAdequacao r={s} empresaId={empresaId} /> : <Aviso tipo="erro">{s.erro}</Aviso>}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ResultadoAdequacao({ r, empresaId }: { r: DadosSetor; empresaId: string }) {
  const ok = r.resumo.faltaTotal === 0;
  return (
    <div className="space-y-4" aria-live="polite">
      <Aviso tipo={ok && r.bloqueios === 0 ? 'ok' : 'info'}>
        {ok ? 'A equipe cobre toda a cobertura pedida.' : `Com a equipe atual, ${r.resumo.faltaTotal} posição(ões) ficam descobertas no mês.`}
        {r.bloqueios > 0 ? ` O motor de regras encontrou ${r.bloqueios} bloqueio(s) para revisar no editor.` : ' Nenhum bloqueio pelo motor de regras.'}
      </Aviso>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metrica icone="cobertura" tom={ok ? 'ok' : 'atencao'} rotulo="Cobertura atendida" valor={`${r.resumo.percentualAtendido.toLocaleString('pt-BR')}%`} texto={`${r.resumo.alocadoTotal} de ${r.resumo.necessarioTotal} posições`} />
        <Metrica icone="calendario" tom={r.resumo.diasComFalta > 0 ? 'atencao' : 'neutro'} rotulo="Dias com falta de gente" valor={r.resumo.diasComFalta} texto="dia × turno descobertos" />
        <Metrica icone="pessoas" rotulo="Pessoas alocadas" valor={r.resumo.pessoasAlocadas} texto="com turno fixo no mês" />
        <Metrica icone="diagnostico" tom={r.bloqueios > 0 ? 'risco' : 'ok'} rotulo="Bloqueios da lei" valor={r.bloqueios} texto={r.alertas > 0 ? `${r.alertas} alerta(s)` : 'nenhum alerta'} />
      </div>

      <Cartao icone="escalas" titulo="Alocação da equipe" subtitulo="Cada linha é uma pessoa; a letra é o turno do dia e “·” é folga.">
        <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold">
          {r.turnos.map((t, i) => <span key={t.id} className={`rounded-full px-2.5 py-0.5 ${CORES_TURNO[i % CORES_TURNO.length]}`}>{inicialDoTurno(t.nome, i)} = {t.nome}</span>)}
        </div>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-center text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-cartao pr-2 text-left font-semibold text-suave">Pessoa</th>
                {r.grade.dias.map((d) => <th key={d} className={`min-w-6 font-semibold ${diaDaSemana(d) === 0 ? 'text-risco-fg' : 'text-suave'}`} title={dataBr(d)}>{d.slice(8)}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.grade.linhas.map((l) => (
                <tr key={l.colaboradorId}>
                  <th scope="row" className="sticky left-0 whitespace-nowrap bg-cartao pr-2 text-left text-sm font-semibold">{l.nome}</th>
                  {l.celulas.map((c, i) => (
                    <td key={i} className={`h-6 rounded-md font-bold ${c === '' ? '' : c === 'F' ? 'bg-fundo text-suave' : CORES_TURNO[Number(c) % CORES_TURNO.length]}`}>{c === 'F' ? '·' : c === '' ? '' : inicialDoTurno(r.turnos[Number(c)]?.nome ?? '', Number(c))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>

      {r.faltas.length > 0 ? (
        <Cartao icone="cobertura" titulo="Onde falta gente" subtitulo="Dias e turnos que a equipe atual não cobre. Reduza a cobertura, ajuste os horários ou reforce a equipe.">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {r.faltas.map((f) => <li key={`${f.data}${f.turnoId}`} className="flex justify-between gap-3 rounded-xl bg-atencao-bg px-3 py-1.5 text-atencao-fg"><span>{dataBr(f.data)} · {r.turnos.find((t) => t.id === f.turnoId)?.nome}</span><strong>{f.alocado}/{f.necessario}</strong></li>)}
          </ul>
        </Cartao>
      ) : null}

      {r.violacoes.length > 0 || r.avisos.length > 0 ? (
        <Cartao icone="diagnostico" titulo="Conferência da lei e avisos">
          <ul className="space-y-1.5 text-sm">
            {r.avisos.map((a) => <li key={a} className="rounded-xl bg-marca-suave px-3 py-1.5">{a}</li>)}
            {r.violacoes.map((v) => <li key={`${v.codigo}${v.severidade}`} className={`rounded-xl px-3 py-1.5 ${v.severidade === 'bloqueio' ? 'bg-risco-bg text-risco-fg' : 'bg-atencao-bg text-atencao-fg'}`}><strong>{v.quantidade}×</strong> {v.exemplo}</li>)}
          </ul>
        </Cartao>
      ) : null}

      {r.diasFechados.length > 0 || r.ausencias.length > 0 ? (
        <Cartao icone="ferias" titulo="Funcionamento e férias" subtitulo="O que foi considerado além dos turnos.">
          <ul className="space-y-1.5 text-sm">
            {r.diasFechados.length > 0 ? <li className="rounded-xl bg-neutro-bg px-3 py-1.5 text-neutro-fg"><strong>{r.diasFechados.length} dia(s) fechado(s)</strong> no mês (ninguém escalado): {r.diasFechados.slice(0, 12).map((d) => dataBr(d).slice(0, 5)).join(', ')}{r.diasFechados.length > 12 ? '…' : ''}.</li> : null}
            {r.ausencias.map((a) => <li key={`${a.colaboradorId}${a.inicio}`} className="rounded-xl bg-violeta-bg px-3 py-1.5 text-violeta-fg"><strong>{a.nome}</strong> · {a.tipo === 'ferias' ? 'férias' : 'afastamento'} de {dataBr(a.inicio)} a {dataBr(a.fim)} ({a.dias} dia{a.dias === 1 ? '' : 's'}): fora da escala nesses dias.</li>)}
          </ul>
        </Cartao>
      ) : null}

      <Cartao icone="pessoas" titulo="Carga de cada pessoa" subtitulo="Média por semana no mês (turno × dias trabalhados).">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs font-semibold uppercase tracking-wide text-suave"><tr><th className="py-1.5 pr-3">Pessoa</th><th className="pr-3">Turno</th><th className="pr-3 text-right">Dias</th><th className="pr-3 text-right">Horas/semana</th><th className="pr-3 text-right">Domingos</th><th className="text-right">Feriados</th></tr></thead>
            <tbody className="divide-y divide-linha">
              {r.pessoas.map((p) => (
                <tr key={p.colaboradorId}>
                  <td className="py-1.5 pr-3 font-semibold">{p.nome}</td>
                  <td className="pr-3">{r.turnos.find((t) => t.id === p.turnoId)?.nome ?? '—'}</td>
                  <td className="pr-3 text-right">{p.diasTrabalhados}</td>
                  <td className="pr-3 text-right">{horasTexto(p.horasSemanaMediaMin)}</td>
                  <td className="pr-3 text-right">{p.domingosTrabalhados}</td>
                  <td className="text-right">{p.feriadosTrabalhados}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>

      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/empresas/${empresaId}/escalas/${r.escalaId}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-marca px-5 text-sm font-semibold text-sobre-marca hover:bg-marca-escuro sm:min-h-9">Abrir no editor de escalas</Link>
        <span className="text-sm text-suave">{r.criada ? 'Rascunho criado.' : 'Rascunho atualizado.'} No editor você ajusta célula a célula, vê os avisos da lei e publica.</span>
      </div>
    </div>
  );
}
