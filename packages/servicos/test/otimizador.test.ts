import { describe, expect, it } from 'vitest';
import type { Alocacao } from '@jc/rules-engine';
import { acordo, colab } from '../../rules-engine/test/util';
import { chamarOtimizador, ErroServico, montarProblema, revalidarSolucoes, type RespostaOtimizador, type TurnoOtimizacao } from '../src';
import { entrada, TURNOS } from './otimizador-util';

describe('montarProblema: as regras legais viram números', () => {
  it('limites da fase 1 (42h), 2 folgas, interjornada de 11h e custo da hora', () => {
    const p = montarProblema(entrada(), { turnos: TURNOS });
    const a = p.colaboradores[0]!;
    expect(a.interjornadaMin).toBe(660);
    expect(a.semanas).toHaveLength(2);                          // duas semanas inteiras (01–07 e 08–14/02)
    expect(a.semanas[0]).toMatchObject({ inicio: '2027-02-01', limiteMin: 2520, alvoMin: 2400, exigeFolgas: true, folgasExigidas: 2, completaNoPeriodo: true, trabalhadosFora: 0 });
    expect(a.custoHoraCentavos).toBe(1500);                     // 3000,00 / 200
    expect(p.periodo).toEqual({ inicio: '2027-02-01', fim: '2027-02-14' });
    expect(p.turnos.find((t) => t.id === 'noite')).toMatchObject({ liquidoMin: 420, noturnoMin: 420 });
  });

  it('só permite os turnos que a pessoa pode fazer: sem hora extra programada e com intervalo mínimo', () => {
    const a = montarProblema(entrada(), { turnos: TURNOS }).colaboradores[0]!;
    expect(a.permitidos).toEqual(['manha', 'noite']);           // 'longo' passa do limite diário e 'sem-intervalo' não tem o intervalo exigido
  });

  it('semana que cruza o início do período não exige folgas sem a escala anterior; com ela, sim', () => {
    const quarta = montarProblema(entrada({}, '2027-02-03', '2027-02-14'), { turnos: TURNOS }).colaboradores[0]!;
    expect(quarta.semanas[0]).toMatchObject({ inicio: '2027-02-01', exigeFolgas: false, completaNoPeriodo: false, diasElegiveisFora: 2 });
    const ant: Alocacao[] = [{ colaboradorId: 'a', data: '2027-02-01', tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 }];
    const com = montarProblema(entrada({ anteriores: ant }, '2027-02-03', '2027-02-14'), { turnos: TURNOS }).colaboradores[0]!;
    expect(com.semanas[0]).toMatchObject({ exigeFolgas: true, trabalhadosFora: 1, diasElegiveisFora: 2, completaNoPeriodo: false });
    expect(com.anteriores).toEqual([{ data: '2027-02-01', inicioMin: 480, fimMin: 1020, liquidoMin: 480 }]);
  });

  it('virada de fase da lei: semana inteira após 15/12/2027 tem teto de 40h', () => {
    const e = entrada({}, '2027-12-20', '2027-12-26');
    expect(montarProblema(e, { turnos: TURNOS }).colaboradores[0]!.semanas[0]!.limiteMin).toBe(2400);
    const f1 = montarProblema(entrada({}, '2027-12-13', '2027-12-19'), { turnos: TURNOS }).colaboradores[0]!.semanas[0]!;
    expect(f1.limiteMin).toBe(2400);                            // a semana de 13 a 19/12 atravessa a virada (15/12): vale a regra mais rígida
  });

  it('ausências, indisponibilidades, vínculo, feriados e cobertura', () => {
    const e = entrada({
      ausencias: [{ colaboradorId: 'a', inicio: '2027-02-02', fim: '2027-02-04', tipo: 'ferias' }, { colaboradorId: 'outra', inicio: '2027-02-02', fim: '2027-02-02', tipo: 'ferias' }],
      feriados: [{ data: '2027-02-05', nome: 'X', abrangencia: 'municipal' }, { data: '2027-03-01', nome: 'fora', abrangencia: 'nacional' }],
      cobertura: [{ diaSemana: 1, faixaInicioMin: 480, faixaFimMin: 720, minimo: 3, ideal: 4 }, { diaSemana: 2, faixaInicioMin: 480, faixaFimMin: 720, minimo: 2 }],
    });
    const p = montarProblema(e, { turnos: TURNOS, indisponibilidades: [{ colaboradorId: 'a', data: '2027-02-10' }, { colaboradorId: 'a', data: '2030-01-01' }] });
    const a = p.colaboradores[0]!;
    expect(a.ausencias).toEqual(['2027-02-02', '2027-02-03', '2027-02-04']);
    expect(a.semanas[0]!.alvoMin).toBe(Math.round((2400 * 4) / 7));   // 3 dias de férias: a meta de horas encolhe 3/7
    expect(a.indisponiveis).toEqual(['2027-02-10']);                // fora do período é ignorada
    expect(a.admissao).toBe('2020-01-01');
    expect(p.feriados).toEqual(['2027-02-05']);
    expect(p.cobertura).toEqual([{ diaSemana: 1, faixaInicioMin: 480, faixaFimMin: 720, minimo: 3, ideal: 4 }, { diaSemana: 2, faixaInicioMin: 480, faixaFimMin: 720, minimo: 2 }]);
  });

  it('rodízio de domingo vem do acordo coletivo', () => {
    const e = entrada();
    e.colaboradores[0] = colab({ colaboradorId: 'a', nome: 'Ana', tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, admissao: '2020-01-01', acordos: [acordo(null, null, [{ tipo: 'rodizio_domingo', parametros: { a_cada_n_semanas: 3 } }])] });
    expect(montarProblema(e, { turnos: TURNOS }).colaboradores[0]!.rodizioDomingo).toBe(3);
    expect(montarProblema(entrada(), { turnos: TURNOS }).colaboradores[0]!.rodizioDomingo).toBeUndefined();
  });

  it('12x36 por acordo permite turno de 11h líquidas; sem o acordo, não', () => {
    const longo: TurnoOtimizacao[] = [{ id: '12h', inicioMin: 420, fimMin: 1140, intervaloMin: 60 }];   // 07–19, 11h líquidas
    const clausula = { tipo: 'regime_compensatorio' as const, parametros: { escala: '12x36', max_diaria_min: 720, max_semanal_min: 2640, folgas_semana: 3 } };
    const com = entrada(); com.colaboradores[0] = colab({ colaboradorId: 'a', nome: 'Ana', tipoEscala: '12x36', jornadaSemanalMin: 2520, divisorContrato: 210, admissao: '2020-01-01', acordos: [acordo('2026-01-01', null, [clausula])] });
    const sem = entrada(); sem.colaboradores[0] = colab({ colaboradorId: 'a', nome: 'Ana', tipoEscala: '12x36', jornadaSemanalMin: 2520, divisorContrato: 210, admissao: '2020-01-01' });
    expect(montarProblema(com, { turnos: longo }).colaboradores[0]!.permitidos).toEqual(['12h']);
    expect(montarProblema(sem, { turnos: longo }).colaboradores[0]!.permitidos).toEqual([]);
  });

  it('referência (escala anterior) vira turno do catálogo; horário desconhecido vira nulo; folga vira nulo', () => {
    const ref: Alocacao[] = [
      { colaboradorId: 'a', data: '2027-02-01', tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 },
      { colaboradorId: 'a', data: '2027-02-02', tipo: 'trabalho', inicioMin: 500, fimMin: 1020, intervaloMin: 60 },
      { colaboradorId: 'a', data: '2027-02-03', tipo: 'folga' },
      { colaboradorId: 'a', data: '2027-01-31', tipo: 'folga' },     // fora do período: ignorada
    ];
    expect(montarProblema(entrada(), { turnos: TURNOS, referencia: ref }).referencia).toEqual([
      { colaboradorId: 'a', data: '2027-02-01', turnoId: 'manha' }, { colaboradorId: 'a', data: '2027-02-02', turnoId: null }, { colaboradorId: 'a', data: '2027-02-03', turnoId: null },
    ]);
  });

  it('turno sem horas líquidas é recusado', () => {
    expect(() => montarProblema(entrada(), { turnos: [{ id: 'x', inicioMin: 480, fimMin: 540, intervaloMin: 60 }] })).toThrow(ErroServico);
  });

  it('opções: tempo, número de soluções e pesos', () => {
    const p = montarProblema(entrada(), { turnos: TURNOS, tempoLimiteS: 10, numSolucoes: 2, semente: 7, pesos: { estabilidade: 99 } });
    expect(p).toMatchObject({ tempoLimiteS: 10, numSolucoes: 2, semente: 7, workers: 4, pesos: { estabilidade: 99 } });
    expect(montarProblema(entrada(), { turnos: TURNOS })).toMatchObject({ tempoLimiteS: 30, numSolucoes: 3 });
  });
});

describe('revalidarSolucoes: o motor TypeScript tem a palavra final', () => {
  const metricas = { faltaCobertura: 0, faltaIdeal: 0, deficitHorasMin: 0, domingosMin: 0, domingosMax: 0, preferenciasNaoAtendidas: 0, custoReais: 0, mudancasEmRelacaoReferencia: 0, objetivo: 0 };
  const cinco = (extra: number): RespostaOtimizador['solucoes'][number] => ({
    status: 'viavel', metricas,
    alocacoes: Array.from({ length: 5 + extra }, (_, i) => ({ colaboradorId: 'a', data: `2027-02-0${i + 1}`, tipo: 'trabalho' as const, turnoId: 'manha', inicioMin: 480, fimMin: 1020, intervaloMin: 60 })),
  });
  it('mantém a solução válida e descarta a que tem bloqueio (6 dias de trabalho em uma semana)', () => {
    const e = entrada({}, '2027-02-01', '2027-02-07');
    const r = revalidarSolucoes(e, { status: 'viavel', tempoMs: 5, solucoes: [cinco(0), cinco(1)] });
    expect(r.propostas.map((p) => p.indice)).toEqual([0]);
    expect(r.descartadas).toBe(1);
    expect(r.divergencias[0]!.indice).toBe(1);
    expect(r.divergencias[0]!.resultado.violacoes.some((v) => v.codigo === 'FOLGAS_SEMANA')).toBe(true);
    expect(r.propostas[0]!.alocacoes[0]).toMatchObject({ tipo: 'trabalho', modeloId: 'manha', inicioMin: 480 });
  });
  it('propaga status e mensagem do otimizador', () => {
    const r = revalidarSolucoes(entrada(), { status: 'inviavel', solucoes: [], mensagem: 'sem solução', tempoMs: 3 });
    expect(r).toMatchObject({ status: 'inviavel', propostas: [], mensagem: 'sem solução', tempoMs: 3 });
  });
});

describe('chamarOtimizador: erros viram mensagens em português', () => {
  const cfg = (f: typeof fetch) => ({ url: 'http://otimizador/', token: 't0k', fetchImpl: f });
  const prob = montarProblema(entrada(), { turnos: TURNOS });
  const resp = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });
  it('envia o token e o problema para /v1/otimizar', async () => {
    let visto: { url: string; init: RequestInit } | undefined;
    const ok: RespostaOtimizador = { status: 'otima', solucoes: [], tempoMs: 1 };
    const r = await chamarOtimizador(cfg((async (url: string, init: RequestInit) => { visto = { url, init }; return new Response(JSON.stringify(ok)); }) as unknown as typeof fetch), prob);
    expect(r).toEqual(ok);
    expect(visto!.url).toBe('http://otimizador/v1/otimizar');
    expect((visto!.init.headers as Record<string, string>).authorization).toBe('Bearer t0k');
    expect(JSON.parse(visto!.init.body as string).periodo.inicio).toBe('2027-02-01');
  });
  it('429, 401/503, outros códigos, rede e tempo esgotado', async () => {
    await expect(chamarOtimizador(cfg(resp(429) as unknown as typeof fetch), prob)).rejects.toThrow(/ocupado/);
    await expect(chamarOtimizador(cfg(resp(401) as unknown as typeof fetch), prob)).rejects.toThrow(/token/);
    await expect(chamarOtimizador(cfg(resp(503) as unknown as typeof fetch), prob)).rejects.toThrow(/token/);
    await expect(chamarOtimizador(cfg(resp(422) as unknown as typeof fetch), prob)).rejects.toThrow(/HTTP 422/);
    await expect(chamarOtimizador(cfg((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch), prob)).rejects.toThrow(/Não foi possível falar/);
    const lento = (async (_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    await expect(chamarOtimizador({ ...cfg(lento), timeoutMs: 20 }, prob)).rejects.toThrow(/demorou/);
  });
});
