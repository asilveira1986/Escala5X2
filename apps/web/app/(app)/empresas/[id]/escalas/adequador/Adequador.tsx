'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { Aviso, Botao, Campo, Cartao, classeCampo, Metrica } from '@/components/ui';
import { balancoDaEquipe, CORES_TURNO, DIAS_TELA, horasTexto, inicialDoTurno, liquidoDoTurno, minutosDeHora, sugerirCobertura, type TurnoForm } from '@/lib/adequador-ui';
import { dataBr, diaDaSemana } from '@jc/rules-engine';
import { adequar, type ResultadoAdequacaoWeb } from './actions';

export type ModeloBase = { id: string; nome: string; inicio: string; fim: string; intervalo: number };
type Props = { empresaId: string; mesPadrao: string; setores: { id: string; nome: string }[]; modelos: ModeloBase[]; equipe: number };

const DIAS_OPCOES = [{ v: '', t: 'O que a lei permite (padrão)' }, { v: '5', t: '5 dias (escala 5x2)' }, { v: '6', t: '6 dias (escala 6x1)' }, { v: '4', t: '4 dias' }];
let seq = 0;
const novaChave = () => `t${++seq}`;

function turnosIniciais(modelos: ModeloBase[], equipe: number): TurnoForm[] {
  const base = modelos.length > 0 ? modelos.slice(0, 4) : [{ id: '', nome: 'Turno 1', inicio: '08:00', fim: '17:00', intervalo: 60 }];
  const minimo = sugerirCobertura(equipe, base.length, 5);
  return base.map((m) => ({ chave: novaChave(), nome: m.nome, inicio: m.inicio, fim: m.fim, intervalo: m.intervalo, modeloId: m.id || null, minimo: [...minimo] }));
}

export function Adequador({ empresaId, mesPadrao, setores, modelos, equipe }: Props) {
  const [mes, setMes] = useState(mesPadrao);
  const [setorId, setSetorId] = useState('');
  const [dias, setDias] = useState('');
  const [turnos, setTurnos] = useState<TurnoForm[]>(() => turnosIniciais(modelos, equipe));
  const [resultado, setResultado] = useState<ResultadoAdequacaoWeb | null>(null);
  const [pendente, iniciar] = useTransition();
  const diasNum = dias ? Number(dias) : 5;
  const originais = useMemo(() => new Map(modelos.map((m) => [m.id, m])), [modelos]);

  const alterar = (chave: string, f: Partial<TurnoForm>) => setTurnos((l) => l.map((t) => {
    if (t.chave !== chave) return t;
    const novo = { ...t, ...f };
    const o = t.modeloId ? originais.get(t.modeloId) : null;
    // mudou o horário de um turno cadastrado: vira um turno só desta adequação (o cadastro não é alterado)
    if (o && (novo.inicio !== o.inicio || novo.fim !== o.fim || novo.intervalo !== o.intervalo)) novo.modeloId = null;
    return novo;
  }));
  const alterarMinimo = (chave: string, indice: number, valor: string) => setTurnos((l) => l.map((t) => (t.chave === chave ? { ...t, minimo: t.minimo.map((m, i) => (i === indice ? Math.max(0, Math.min(500, Math.floor(Number(valor) || 0))) : m)) } : t)));
  const sugerir = () => setTurnos((l) => { const m = sugerirCobertura(equipe, l.length, diasNum); return l.map((t) => ({ ...t, minimo: [...m] })); });
  const adicionar = () => setTurnos((l) => (l.length >= 6 ? l : [...l, { chave: novaChave(), nome: `Turno ${l.length + 1}`, inicio: '14:00', fim: '23:00', intervalo: 60, modeloId: null, minimo: Array(7).fill(0) }]));
  const remover = (chave: string) => setTurnos((l) => (l.length <= 1 ? l : l.filter((t) => t.chave !== chave)));

  const balanco = balancoDaEquipe(turnos, equipe, diasNum);
  const invalido = turnos.some((t) => liquidoDoTurno(t) === null || !t.nome.trim());
  const semCobertura = turnos.every((t) => t.minimo.every((m) => m === 0));

  const gerar = () => iniciar(async () => {
    setResultado(null);
    const r = await adequar({ empresaId, mes, setorId: setorId || null, diasPorSemana: dias ? Number(dias) : null, turnos: turnos.map((t) => ({ nome: t.nome, inicio: t.inicio, fim: t.fim, intervalo: t.intervalo, modeloId: t.modeloId, minimo: t.minimo })) });
    setResultado(r);
  });

  return (
    <div className="space-y-4">
      <Cartao icone="escalas" titulo="1. Período" subtitulo="Para qual mês e setor você quer alocar a equipe.">
        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Mês"><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} required className={classeCampo} /></Campo>
          {setores.length > 0 ? (
            <Campo rotulo="Setor" dica="Em branco: a empresa toda.">
              <select value={setorId} onChange={(e) => setSetorId(e.target.value)} className={classeCampo}><option value="">Todos os setores</option>{setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
            </Campo>
          ) : null}
          <Campo rotulo="Dias de trabalho por semana"><select value={dias} onChange={(e) => setDias(e.target.value)} className={classeCampo}>{DIAS_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}</select></Campo>
        </div>
      </Cartao>

      <Cartao icone="turnos" titulo="2. Escala de horas" subtitulo="Ajuste os horários de cada turno. Mudar um turno cadastrado vale só para esta adequação; o cadastro não muda."
        acoes={turnos.length < 6 ? <Botao variante="secundario" onClick={adicionar}>Adicionar turno</Botao> : null}>
        <div className="space-y-3">
          {turnos.map((t, ti) => {
            const liq = liquidoDoTurno(t);
            return (
              <div key={t.chave} className="rounded-2xl border border-linha p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <span aria-hidden className={`mb-1 grid size-9 place-items-center rounded-xl text-sm font-bold ${CORES_TURNO[ti % CORES_TURNO.length]}`}>{inicialDoTurno(t.nome, ti)}</span>
                  <Campo rotulo="Turno"><input value={t.nome} maxLength={40} onChange={(e) => alterar(t.chave, { nome: e.target.value })} className={`${classeCampo} w-36`} /></Campo>
                  <Campo rotulo="Entrada"><input type="time" value={t.inicio} onChange={(e) => alterar(t.chave, { inicio: e.target.value })} className={`${classeCampo} w-28`} /></Campo>
                  <Campo rotulo="Saída"><input type="time" value={t.fim} onChange={(e) => alterar(t.chave, { fim: e.target.value })} className={`${classeCampo} w-28`} /></Campo>
                  <Campo rotulo="Intervalo (min)"><input type="number" min={0} max={240} step={5} value={t.intervalo} onChange={(e) => alterar(t.chave, { intervalo: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })} className={`${classeCampo} w-24`} /></Campo>
                  <p className="mb-2 text-sm font-semibold">{liq === null ? <span className="text-risco-fg">horário inválido</span> : <>{horasTexto(liq)} líquidas · {horasTexto(liq * diasNum)}/semana</>}</p>
                  {turnos.length > 1 ? <button type="button" onClick={() => remover(t.chave)} aria-label={`Remover o turno ${t.nome}`} className="mb-1 ml-auto rounded-full px-3 py-1.5 text-sm font-semibold text-risco-fg hover:bg-risco-bg">Remover</button> : null}
                </div>
                <fieldset className="mt-3">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-suave">Pessoas necessárias neste turno, por dia</legend>
                  <div className="mt-1 grid grid-cols-7 gap-1.5 sm:max-w-xl">
                    {DIAS_TELA.map((d) => (
                      <label key={d.indice} className="block text-center text-xs font-semibold text-suave">
                        {d.rotulo}
                        <input type="number" min={0} max={500} value={t.minimo[d.indice]} onChange={(e) => alterarMinimo(t.chave, d.indice, e.target.value)} aria-label={`${t.nome}: pessoas na ${d.rotulo}`} className={`${classeCampo} mt-0.5 !min-h-9 text-center`} />
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Botao variante="secundario" onClick={sugerir}>Sugerir cobertura pela equipe</Botao>
          <p className={`text-sm ${balanco.sobra < 0 ? 'font-semibold text-atencao-fg' : 'text-suave'}`}>
            Equipe: <strong>{equipe}</strong> pessoa(s) · a cobertura pede <strong>{balanco.posicoesSemana}</strong> posições por semana, o que exige cerca de <strong>{balanco.pessoasNecessarias}</strong> pessoa(s) a {diasNum} dias.
            {balanco.sobra < 0 ? ` Faltam ~${-balanco.sobra} pessoa(s): o resultado vai mostrar onde fica descoberto.` : balanco.sobra > 0 ? ` Sobram ~${balanco.sobra}.` : ' Fecha na medida.'}
          </p>
        </div>
      </Cartao>

      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={gerar} disabled={pendente || invalido || semCobertura || equipe === 0}>{pendente ? 'Alocando a equipe…' : 'Gerar alocação da equipe'}</Botao>
        {equipe === 0 ? <span className="text-sm text-risco-fg">Não há colaboradores com contrato vigente: cadastre a equipe primeiro.</span> : semCobertura ? <span className="text-sm text-suave">Informe quantas pessoas cada turno precisa em pelo menos um dia.</span> : invalido ? <span className="text-sm text-risco-fg">Confira os horários dos turnos.</span> : <span className="text-sm text-suave">Cria (ou atualiza) o rascunho “Adequação {mes}”. Nada é publicado.</span>}
      </div>

      {resultado && !resultado.ok ? <Aviso tipo="erro">{resultado.erro}</Aviso> : null}
      {resultado && resultado.ok ? <ResultadoAdequacao r={resultado} empresaId={empresaId} /> : null}
    </div>
  );
}

export function ResultadoAdequacao({ r, empresaId }: { r: Extract<ResultadoAdequacaoWeb, { ok: true }>; empresaId: string }) {
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
