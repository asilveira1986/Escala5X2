import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, novoUsuario, prepararBanco } from '../../db/test/helpers';
import { acordo, colab } from '../../rules-engine/test/util';
import { gerarFolhaCsv } from '../../documents/src/folha';
import { calcularFechamento, carregarBaseFechamento, fecharFolha, lerBaseFechamento, podeFechar, publicarEscala, type BaseFechamento, type EntradaEscala, type Lancamento } from '../src';
import { entrada } from './otimizador-util';
import { rpcPg, rpcPgServidor } from './pg-rpc';

const somar = (d: string, i: number) => new Date(Date.parse(`${d}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
const dia = (c: string, data: string, ini = 480, fim = 1020, inter = 60) => ({ colaboradorId: c, data, tipo: 'trabalho' as const, inicioMin: ini, fimMin: fim, intervaloMin: inter });
let seq = 0;
const lanc = (c: string, data: string, minutos: number, extra: Partial<Lancamento> = {}): Lancamento => ({
  id: ++seq, colaborador_id: c, data, minutos, origem: minutos > 0 ? 'manual' : 'compensacao', descricao: null, vence_em: minutos > 0 ? '2027-12-31' : null, estorna_id: null, criado_em: '', ...extra,
});
const colabBase = (id: string, nome: string, extra: Partial<BaseFechamento['colaboradores'][number]> = {}) => ({ id, nome, matricula: `M-${id}`, cargo: 'Caixa', setor: 'Loja', admissao: '2020-01-01', desligamento: null, ...extra });
const baseDe = (extra: Partial<BaseFechamento> = {}): BaseFechamento => ({
  inicio: '2027-02-01', fim: '2027-02-28', colaboradores: [colabBase('a', 'Ana')], escalas: [{ id: 'e1', nome: 'Fevereiro', versao: 1, hash: 'h1', inicio: '2027-02-01', fim: '2027-02-28' }],
  ausencias: [], banco: [], versao_vigente: null, ...extra,
});
/** 4 semanas de segunda a sexta, 8h líquidas: 160h, sem extras. */
const mesCheio = (c: string) => Array.from({ length: 28 }, (_, i) => i).filter((i) => i % 7 < 5).map((i) => dia(c, somar('2027-02-01', i)));
const entradaMes = (alocs: ReturnType<typeof dia>[], extra: Partial<EntradaEscala> = {}) => entrada({ alocacoes: alocs, ...extra }, '2027-02-01', '2027-02-28');

describe('calcularFechamento (lógica pura)', () => {
  it('mês de 5x2: 160h trabalhadas, nenhuma hora extra, dias e domingos/feriados zerados', () => {
    const f = calcularFechamento(baseDe(), [entradaMes(mesCheio('a'))]);
    expect(f.linhas).toHaveLength(1);
    expect(f.linhas[0]).toMatchObject({ nome: 'Ana', matricula: 'M-a', diasTrabalhados: 20, trabalhadasMin: 9600, extrasMin: 0, domingosTrabalhados: 0, temContrato: true, adicionalHePercentual: 50 });
    expect(f.competencia).toBe('2027-02');
    expect(f.totais).toMatchObject({ colaboradores: 1, trabalhadasMin: 9600, extrasMin: 0 });
    expect(podeFechar(f)).toBe(true);
    expect(f.avisos.map((a) => a.codigo)).toEqual(['ORIGEM_ESCALA']);
  });
  it('horas extras diárias, domingo e feriado trabalhados entram nas colunas certas', () => {
    const alocs = [dia('a', '2027-02-02', 480, 1140), dia('a', '2027-02-07'), dia('a', '2027-02-10')];      // 10h líquidas numa terça; um domingo; uma quarta feriada
    const e = entradaMes(alocs, { feriados: [{ data: '2027-02-10', nome: 'Feriado local', abrangencia: 'municipal' }] });
    const l = calcularFechamento(baseDe(), [e]).linhas[0]!;
    expect(l.extrasMin).toBe(120);                                   // 10h − 8h no dia
    expect(l.domingoMin).toBe(480); expect(l.domingosTrabalhados).toBe(1);
    expect(l.feriadoMin).toBe(480); expect(l.feriadosTrabalhados).toBe(1);
    expect(l.trabalhadasMin).toBe(600 + 480 + 480);
  });
  it('adicional noturno: 22h–06h vira horas computadas pela hora reduzida', () => {
    const l = calcularFechamento(baseDe(), [entradaMes([dia('a', '2027-02-02', 1320, 1800)])]).linhas[0]!;
    expect(l.noturnasRelogioMin).toBe(420);
    expect(l.noturnasComputadasMin).toBe(480);
  });
  it('só conta o que está dentro do mês: lançamentos de outro mês e escalas parciais', () => {
    const e = entrada({ alocacoes: [dia('a', '2027-01-30'), dia('a', '2027-02-02'), dia('a', '2027-03-01')] }, '2027-01-25', '2027-03-05');
    const f = calcularFechamento(baseDe({ escalas: [{ id: 'e1', nome: 'Longa', versao: 1, hash: null, inicio: '2027-01-25', fim: '2027-03-05' }] }), [e]);
    expect(f.linhas[0]!.diasTrabalhados).toBe(1);
    expect(f.avisos.some((a) => a.codigo === 'MES_PARCIAL')).toBe(false);          // a escala cobre o mês todo
    const parcial = calcularFechamento(baseDe(), [entrada({ alocacoes: [dia('a', '2027-02-02')] }, '2027-02-01', '2027-02-14')]);
    expect(parcial.avisos.find((a) => a.codigo === 'MES_PARCIAL')!.mensagem).toMatch(/14 dia\(s\)/);
  });
  it('sem escala publicada: bloqueio, não dá para fechar', () => {
    const f = calcularFechamento(baseDe({ escalas: [] }), []);
    expect(f.avisos[0]).toMatchObject({ codigo: 'SEM_ESCALA', severidade: 'bloqueio' });
    expect(podeFechar(f)).toBe(false);
    expect(podeFechar(calcularFechamento(baseDe({ colaboradores: [], escalas: [] }), []))).toBe(false);
  });
  it('ausências: dias de férias e de afastamento dentro do mês (ausência que começa antes só conta o que cai no mês)', () => {
    const f = calcularFechamento(baseDe({ ausencias: [{ colaboradorId: 'a', inicio: '2027-01-25', fim: '2027-02-03', tipo: 'ferias' }, { colaboradorId: 'a', inicio: '2027-02-20', fim: '2027-02-21', tipo: 'afastamento' }] }), [entradaMes(mesCheio('a'))]);
    expect(f.linhas[0]).toMatchObject({ diasFerias: 3, diasAfastamento: 2 });
  });
  it('banco de horas: créditos, débitos, faltas (sem as estornadas), pagamentos, saldo final e vencido com valor estimado', () => {
    const banco = [
      lanc('a', '2026-08-01', 180, { vence_em: '2027-01-31' }),                 // venceu antes do mês: continua a pagar
      lanc('a', '2027-02-03', 120, { vence_em: '2027-08-03' }),                  // crédito do mês
      lanc('a', '2027-02-05', -60, { origem: 'falta' }),                          // falta
      lanc('a', '2027-02-06', -30, { origem: 'falta' }),                          // falta estornada abaixo
      lanc('a', '2027-02-07', 30, { origem: 'estorno', estorna_id: seq, vence_em: '2027-08-07' }),
      lanc('a', '2027-02-10', -45, { origem: 'compensacao' }),
      lanc('b', '2027-02-04', 999, { vence_em: '2027-08-04' }),                  // de outra pessoa: não entra
    ];
    const l = calcularFechamento(baseDe({ banco }), [entradaMes(mesCheio('a'))]).linhas[0]!;
    expect(l.faltasMin).toBe(60);                                                // a falta de 30 foi estornada
    expect(l.bancoCreditoMin).toBe(150);                                        // 120 + 30 do estorno
    expect(l.bancoDebitoMin).toBe(60 + 30 + 45);
    expect(l.bancoPagoMin).toBe(0);
    expect(l.bancoSaldoFinalMin).toBe(195);                                      // 180 + 120 − 60 − 30 + 30 − 45
    expect(l.bancoVencidoMin).toBe(180);                                         // o crédito que venceu em janeiro continua inteiro: compensar em fevereiro só consome o válido
    expect(l.bancoAVencerMin).toBe(0);
    expect(l.valorVencidoCentavos).toBe(6750);                                   // 3h × R$ 15,00 (3.000,00 / 200) × 1,5
    const f = calcularFechamento(baseDe({ banco }), [entradaMes(mesCheio('a'))]);
    expect(f.avisos.some((a) => a.codigo === 'VENCIDO_A_PAGAR')).toBe(true);
  });
  it('pagamento do vencido no mês zera o vencido e aparece em "pagas no mês"', () => {
    const banco = [lanc('a', '2026-08-01', 120, { vence_em: '2027-01-31' }), lanc('a', '2027-02-20', -120, { origem: 'pagamento' })];
    const l = calcularFechamento(baseDe({ banco }), [entradaMes(mesCheio('a'))]).linhas[0]!;
    expect(l).toMatchObject({ bancoPagoMin: 120, bancoDebitoMin: 0, bancoVencidoMin: 0, bancoSaldoFinalMin: 0, valorVencidoCentavos: 0 });
  });
  it('avisos de dados: sem matrícula (só quem tem horas) e sem contrato', () => {
    const base = baseDe({ colaboradores: [colabBase('a', 'Ana', { matricula: null }), colabBase('x', 'Xavier', { matricula: null }), colabBase('s', 'Sem Contrato')] });
    const e = entradaMes(mesCheio('a'));
    const f = calcularFechamento(base, [e]);
    expect(f.avisos.find((a) => a.codigo === 'SEM_MATRICULA')!.mensagem).toMatch(/1 colaborador\(es\).*Ana/);
    expect(f.avisos.find((a) => a.codigo === 'SEM_CONTRATO')!.mensagem).toMatch(/2 colaborador\(es\)/);
    const sc = f.linhas.find((l) => l.nome === 'Sem Contrato')!;
    expect(sc).toMatchObject({ temContrato: false, trabalhadasMin: 0 });
  });
  it('regime 12x36 por acordo usa o limite diário do acordo (sem hora extra por turno de 11h)', () => {
    const clausula = { tipo: 'regime_compensatorio' as const, parametros: { escala: '12x36', max_diaria_min: 720, max_semanal_min: 2640, folgas_semana: 3 } };
    const e = entradaMes([dia('a', '2027-02-02', 420, 1140), dia('a', '2027-02-04', 420, 1140)]);          // 11h líquidas
    e.colaboradores = [colab({ colaboradorId: 'a', nome: 'Ana', tipoEscala: '12x36', jornadaSemanalMin: 2520, divisorContrato: 210, admissao: '2020-01-01', acordos: [acordo('2026-01-01', null, [clausula])] })];
    expect(calcularFechamento(baseDe(), [e]).linhas[0]!.extrasMin).toBe(0);
    const sem = entradaMes([dia('a', '2027-02-02', 420, 1140)]);
    sem.colaboradores = [colab({ colaboradorId: 'a', nome: 'Ana', tipoEscala: '12x36', jornadaSemanalMin: 2520, divisorContrato: 210, admissao: '2020-01-01' })];
    expect(calcularFechamento(baseDe(), [sem]).linhas[0]!.extrasMin).toBe(180);                              // sem o acordo, 11h − 8h
  });
  it('mesma alocação em duas versões da escala não conta em dobro', () => {
    const f = calcularFechamento(baseDe({ escalas: [{ id: 'e1', nome: 'v1', versao: 1, hash: null, inicio: '2027-02-01', fim: '2027-02-28' }, { id: 'e2', nome: 'v2', versao: 2, hash: null, inicio: '2027-02-01', fim: '2027-02-28' }] }), [entradaMes(mesCheio('a')), entradaMes(mesCheio('a'))]);
    expect(f.linhas[0]!.diasTrabalhados).toBe(20);
  });
  it('a leitura da base do banco valida o formato', () => {
    expect(() => lerBaseFechamento({ inicio: 'x' })).toThrow();
    expect(lerBaseFechamento(baseDe()).colaboradores).toHaveLength(1);
  });
});

describe('fechamento de ponta a ponta (banco real)', () => {
  let db: Client;
  let rh: string, ua: string;
  let org: string, emp: string, A: string, B: string, esc: string, hoje: string;
  const mesPassado = () => { const d = new Date(`${hoje}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d; };
  const ini = () => mesPassado().toISOString().slice(0, 10);
  const nDias = () => new Date(Date.UTC(mesPassado().getUTCFullYear(), mesPassado().getUTCMonth() + 1, 0)).getUTCDate();
  const cliente = () => rpcPg(db, rh);

  beforeAll(async () => {
    db = await prepararBanco();
    hoje = (await db.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
    rh = await novoUsuario(db, 'rh'); ua = await novoUsuario(db, 'ua');
    org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
    await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, ua]);
    emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'Loja Alfa','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
    const mk = async (n: string, cpf: string, mat: string | null, u: string | null) => {
      const id = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, matricula, cargo, usuario_id) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4,'Caixa',$5) returning id`, [emp, n, cpf, mat, u])).rows[0].id as string;
      await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1,'[2020-01-01,)',3000,2400,200,'5x2')`, [id]);
      return id;
    };
    A = await mk('Ana', '1', 'M001', ua); B = await mk('Bia', '2', null, null);
    // escala publicada do mês passado inteiro: 5 dias úteis por semana de 8h
    esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Mês passado',daterange($2::date,($2::date + $3::int)),$4) returning id`, [emp, ini(), nDias(), rh])).rows[0].id;
    for (let i = 0; i < nDias(); i++) {
      const d = new Date(Date.parse(`${ini()}T00:00:00Z`) + i * 86_400_000);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      for (const c of [A, B]) await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',480,1020,60)`, [esc, c, d.toISOString().slice(0, 10)]);
    }
    await publicarEscala(cliente(), rpcPgServidor(db), esc, rh);
    await db.query(`insert into ausencia (empresa_id, colaborador_id, periodo, tipo) values ($1,$2,daterange($3::date,($3::date + 2)),'afastamento')`, [emp, B, ini()]);
  });
  afterAll(async () => { await db.end(); });

  it('lê a base e as escalas publicadas, calcula, fecha e guarda o retrato com hash', async () => {
    const { base, entradas } = await carregarBaseFechamento(cliente(), emp, ini());
    expect(base.escalas).toHaveLength(1);
    expect(entradas).toHaveLength(1);
    expect(base.colaboradores.map((c) => [c.nome, c.matricula])).toEqual([['Ana', 'M001'], ['Bia', null]]);
    expect(base.ausencias).toEqual([expect.objectContaining({ colaboradorId: B, tipo: 'afastamento' })]);
    const f = calcularFechamento(base, entradas);
    const ana = f.linhas.find((l) => l.nome === 'Ana')!;
    expect(ana.trabalhadasMin).toBe(ana.diasTrabalhados * 480);
    expect(ana.diasTrabalhados).toBeGreaterThanOrEqual(19);
    expect(f.linhas.find((l) => l.nome === 'Bia')!.diasAfastamento).toBe(2);
    expect(f.avisos.find((a) => a.codigo === 'SEM_MATRICULA')!.mensagem).toMatch(/Bia/);
    expect(podeFechar(f)).toBe(true);

    const id = await fecharFolha(cliente(), emp, f);
    const r = (await db.query(`select versao, status, dados_hash, dados->>'competencia' c, jsonb_array_length(dados->'linhas') n from fechamento_folha where id=$1`, [id])).rows[0];
    expect(r).toMatchObject({ versao: 1, status: 'fechado', c: f.competencia, n: 2 });
    expect((await comoUsuario(db, rh, (c) => c.query(`select fechamento_integro($1) ok`, [id]))).rows[0].ok).toBe(true);
  });
  it('reabrir exige motivo e gera a versão 2; o hash muda se o conteúdo mudar', async () => {
    const { base, entradas } = await carregarBaseFechamento(cliente(), emp, ini());
    const f = calcularFechamento(base, entradas);
    await expect(fecharFolha(cliente(), emp, f)).rejects.toThrow(/motivo da reabertura/);
    const v2 = await fecharFolha(cliente(), emp, { ...f, linhas: f.linhas.map((l) => (l.nome === 'Ana' ? { ...l, faltasMin: 60 } : l)) }, 'Falta da Ana confirmada após o fechamento');
    const vs = (await db.query(`select versao, status, dados_hash from fechamento_folha where empresa_id=$1 order by versao`, [emp])).rows;
    expect(vs.map((x) => [x.versao, x.status])).toEqual([[1, 'substituido'], [2, 'fechado']]);
    expect(vs[0].dados_hash).not.toBe(vs[1].dados_hash);
    expect((await carregarBaseFechamento(cliente(), emp, ini())).base.versao_vigente).toBe(2);
  });
  it('fechar mês sem bloqueios resolvidos é recusado antes de chegar ao banco; mês corrente também é recusado pelo banco', async () => {
    const { base } = await carregarBaseFechamento(cliente(), emp, ini());
    await expect(fecharFolha(cliente(), emp, calcularFechamento({ ...base, escalas: [] }, []))).rejects.toThrow(/bloqueios/);
    const atual = (await db.query(`select date_trunc('month', hoje_sp())::date::text d`)).rows[0].d as string;
    const { base: b2, entradas: e2 } = await carregarBaseFechamento(cliente(), emp, atual);
    await expect(fecharFolha(cliente(), emp, { ...calcularFechamento(b2, e2), linhas: calcularFechamento(base, [entradaMes(mesCheio('a'))]).linhas })).rejects.toThrow(/bloqueios|mês já encerrado/);
  });
  it('fecha pelo ponto: lê as marcações do banco, calcula, guarda a origem no retrato e o arquivo traz as colunas do ponto', async () => {
    const { base, entradas } = await carregarBaseFechamento(cliente(), emp, ini());
    const dias = Array.from({ length: nDias() }, (_, i) => new Date(Date.parse(`${ini()}T00:00:00Z`) + i * 86_400_000)).filter((d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6).map((d) => d.toISOString().slice(0, 10));
    let n = 0;
    const marca = (c: string, data: string, hora: string, id: string) => db.query(
      `insert into marcacao_ponto (organizacao_id, empresa_id, colaborador_id, momento, tipo_identificador, identificador_hash, identificador_final, nsr) values ($6,$1,$2,$3::timestamptz,'cpf',$4,'0000',$5)`, [emp, c, `${data}T${hora}:00-03:00`, `${id}-${data}-${hora}`, ++n, org]);
    // Ana marcou todos os dias certinho, menos o primeiro (chegou 40 min atrasada); Bia não marcou nada
    for (const [i, data] of dias.entries()) { await marca(A, data, i === 0 ? '08:40' : '08:00', 'a'); await marca(A, data, '17:00', 'a'); }
    const marcacoes = (await db.query<{ colaborador_id: string; momento: string }>(`select colaborador_id, momento::text from marcacao_ponto where empresa_id=$1 and colaborador_id is not null order by momento, id`, [emp])).rows;
    const f = calcularFechamento(base, entradas, { origem: 'ponto', marcacoes, semMarcacao: 'falta' });
    const ana = f.linhas.find((l) => l.nome === 'Ana')!, bia = f.linhas.find((l) => l.nome === 'Bia')!;
    expect(ana.trabalhadasMin).toBe(dias.length * 480 - 40);
    expect(ana.diasAjustadosPeloPonto).toBe(1);
    const semAfastamento = dias.filter((d) => d >= new Date(Date.parse(`${ini()}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10));   // os 2 primeiros dias, Bia está afastada
    expect(bia).toMatchObject({ diasSemMarcacao: semAfastamento.length, faltasPontoMin: semAfastamento.length * 480 });
    expect(f.origem).toBe('ponto');
    expect(podeFechar(f)).toBe(true);
    const id = await fecharFolha(cliente(), emp, f, 'Refeito pelo ponto apurado');
    const r = (await db.query(`select dados->>'origem' o, dados->>'semMarcacao' s from fechamento_folha where id=$1`, [id])).rows[0];
    expect(r).toEqual({ o: 'ponto', s: 'falta' });
    expect((await comoUsuario(db, rh, (c) => c.query(`select fechamento_integro($1) ok`, [id]))).rows[0].ok).toBe(true);
    const dados = (await db.query(`select dados from fechamento_folha where id=$1`, [id])).rows[0].dados;
    const csv = gerarFolhaCsv(dados);
    expect(csv.split('\r\n')[0]).toMatch(/Faltas pelo ponto \(horas\);Dias previstos sem marcação;Horas extras enviadas ao banco \(h\)$/);
  });
  it('colaborador não consegue ler a base do fechamento nem fechar', async () => {
    await expect(carregarBaseFechamento(rpcPg(db, ua), emp, ini())).rejects.toThrow(/sem permissão/);
  });
});

describe('fechamento pelo ponto apurado (lógica pura)', () => {
  const marc = (c: string, data: string, hora: string) => ({ colaborador_id: c, momento: `${data}T${hora}:00-03:00` });
  const par = (c: string, data: string, ini = '08:00', fim = '17:00') => [marc(c, data, ini), marc(c, data, fim)];
  const normal = (alocs: ReturnType<typeof dia>[]) => alocs.flatMap((a) => par(a.colaboradorId, a.data));
  const alocs = mesCheio('a');
  const feito = (marcacoes: ReturnType<typeof marc>[], extra: Partial<EntradaEscala> = {}, semMarcacao?: 'escala' | 'falta', baseExtra: Partial<BaseFechamento> = {}) =>
    calcularFechamento(baseDe(baseExtra), [entradaMes(alocs, extra)], { origem: 'ponto', marcacoes, semMarcacao });
  const linhaA = (f: ReturnType<typeof calcularFechamento>) => f.linhas[0]!;
  const codigos = (f: ReturnType<typeof calcularFechamento>) => f.avisos.map((a) => a.codigo);

  it('ponto dentro da tolerância (e só entrada/saída, com intervalo pré-assinalado) vale o previsto: 160h, sem ajuste', () => {
    const f = feito(normal(alocs));
    expect(f.origem).toBe('ponto');
    expect(linhaA(f)).toMatchObject({ trabalhadasMin: 9600, extrasMin: 0, diasTrabalhados: 20, diasSemMarcacao: 0, diasPendentes: 0, diasAjustadosPeloPonto: 0, faltasPontoMin: 0 });
    expect(codigos(f)).toContain('ORIGEM_PONTO');
    expect(codigos(f)).not.toContain('ORIGEM_ESCALA');
    expect(podeFechar(f)).toBe(true);
  });

  it('atraso acima da tolerância desconta o atraso; saída depois do turno soma o tempo a mais', () => {
    const ms = normal(alocs).filter((m) => !m.momento.startsWith('2027-02-02') && !m.momento.startsWith('2027-02-03'));
    const f = feito([...ms, ...par('a', '2027-02-02', '08:30'), ...par('a', '2027-02-03', '08:00', '18:00')]);
    expect(linhaA(f).trabalhadasMin).toBe(9600 - 30 + 60);
    expect(linhaA(f).diasAjustadosPeloPonto).toBe(2);
    expect(linhaA(f).extrasMin).toBeGreaterThan(0);                 // 9h no dia: a hora a mais é extra
  });

  it('intervalo marcado (4 marcações) entra pelo que foi feito: pausa maior desconta, pausa menor soma', () => {
    const ms = normal(alocs).filter((m) => !m.momento.startsWith('2027-02-02'));
    const quatro = [marc('a', '2027-02-02', '08:00'), marc('a', '2027-02-02', '12:00'), marc('a', '2027-02-02', '12:30'), marc('a', '2027-02-02', '17:00')];
    const f = feito([...ms, ...quatro]);
    expect(linhaA(f).trabalhadasMin).toBe(9600 + 30);               // pausa de 30 min em vez de 60
  });

  it('dia previsto sem nenhuma marcação: por padrão vale o previsto (ponto não tratado) e vira aviso; "falta" desconta', () => {
    const ms = normal(alocs).filter((m) => !m.momento.startsWith('2027-02-04'));
    const padrao = feito(ms);
    expect(linhaA(padrao)).toMatchObject({ trabalhadasMin: 9600, diasSemMarcacao: 1, faltasPontoMin: 0 });
    expect(codigos(padrao)).toContain('PONTO_SEM_MARCACAO');
    const falta = feito(ms, {}, 'falta');
    expect(linhaA(falta)).toMatchObject({ trabalhadasMin: 9600 - 480, diasSemMarcacao: 1, faltasPontoMin: 480, diasTrabalhados: 19 });
    expect(falta.semMarcacao).toBe('falta');
    expect(falta.totais.faltasPontoMin).toBe(480);
  });

  it('marcação incompleta (ímpar) nunca desconta: vale o previsto e fica como pendência', () => {
    const ms = normal(alocs).filter((m) => !(m.momento.startsWith('2027-02-04') && m.momento.includes('T17:00')));
    const f = feito(ms, {}, 'falta');
    expect(linhaA(f)).toMatchObject({ trabalhadasMin: 9600, diasPendentes: 1, diasSemMarcacao: 0, faltasPontoMin: 0 });
    expect(codigos(f)).toContain('PONTO_PENDENTE');
  });

  it('trabalho em dia de folga (marcação completa) entra como trabalhado; em férias não entra', () => {
    const sabado = '2027-02-06', ferias = '2027-02-10';
    const comFerias = alocs.filter((a) => a.data !== ferias);
    const f = calcularFechamento(baseDe({ ausencias: [{ colaboradorId: 'a', inicio: ferias, fim: ferias, tipo: 'ferias' }] }), [entradaMes(comFerias, { ausencias: [{ colaboradorId: 'a', inicio: ferias, fim: ferias }] } as Partial<EntradaEscala>)],
      { origem: 'ponto', marcacoes: [...normal(comFerias), ...par('a', sabado, '08:00', '12:00'), ...par('a', ferias)] });
    expect(linhaA(f).trabalhadasMin).toBe(9600 - 480 + 240);        // 19 dias + 4h do sábado; o dia de férias não conta
    expect(codigos(f)).toEqual(expect.arrayContaining(['PONTO_EM_FOLGA', 'PONTO_EM_AUSENCIA']));
  });

  it('sem nenhuma marcação no mês: bloqueio (não dá para fechar pelo ponto), com orientação', () => {
    const f = feito([]);
    expect(codigos(f)).toContain('PONTO_SEM_IMPORTACAO');
    expect(podeFechar(f)).toBe(false);
  });

  it('pela escala (padrão) nada muda: sem campos do ponto e a mesma origem de antes', () => {
    const f = calcularFechamento(baseDe(), [entradaMes(alocs)]);
    expect(f.origem).toBe('escala');
    expect(f.semMarcacao).toBeUndefined();
    expect(linhaA(f)).toMatchObject({ trabalhadasMin: 9600, diasSemMarcacao: 0, diasPendentes: 0, faltasPontoMin: 0, diasAjustadosPeloPonto: 0 });
    expect(codigos(f)).toContain('ORIGEM_ESCALA');
  });
});

describe('fechamento pelo ponto × banco de horas', () => {
  const marc = (c: string, data: string, hora: string) => ({ colaborador_id: c, momento: `${data}T${hora}:00-03:00` });
  const par = (c: string, data: string, ini = '08:00', fim = '17:00') => [marc(c, data, ini), marc(c, data, fim)];
  const alocs = mesCheio('a');
  const marcacoes = [...alocs.flatMap((a) => par('a', a.data)).filter((m) => !m.momento.startsWith('2027-02-02')), ...par('a', '2027-02-02', '08:00', '20:00')];   // 3 h a mais no dia 2 (11h: 8 normais + 3 extras)
  const fechar = (banco: Lancamento[]) => calcularFechamento(baseDe({ banco }), [entradaMes(alocs)], { origem: 'ponto', marcacoes });
  it('crédito de ponto lançado no banco sai das horas extras a pagar (não paga duas vezes) e vira aviso', () => {
    const sem = fechar([]);
    expect(sem.linhas[0]!.extrasMin).toBeGreaterThanOrEqual(180);
    const bruto = sem.linhas[0]!.extrasMin;
    const com = fechar([lanc('a', '2027-02-02', 120, { origem: 'ponto' })]);
    expect(com.linhas[0]).toMatchObject({ extrasNoBancoMin: 120, extrasMin: bruto - 120, bancoCreditoMin: 120 });
    expect(com.totais.extrasNoBancoMin).toBe(120);
    expect(com.avisos.map((a) => a.codigo)).toContain('EXTRAS_NO_BANCO');
  });
  it('nunca abate mais do que existe de extra; crédito estornado ou de outra origem não abate; pela escala nada muda', () => {
    const grande = fechar([lanc('a', '2027-02-02', 1000, { origem: 'ponto' })]);
    expect(grande.linhas[0]!.extrasMin).toBe(0);
    const c1 = lanc('a', '2027-02-02', 120, { origem: 'ponto' });
    const estornado = fechar([c1, lanc('a', '2027-02-05', -120, { origem: 'estorno', estorna_id: c1.id })]);
    expect(estornado.linhas[0]!.extrasNoBancoMin).toBe(0);
    expect(fechar([lanc('a', '2027-02-02', 120, { origem: 'manual' })]).linhas[0]!.extrasNoBancoMin).toBe(0);
    const pelaEscala = calcularFechamento(baseDe({ banco: [lanc('a', '2027-02-02', 120, { origem: 'ponto' })] }), [entradaMes(alocs)]);
    expect(pelaEscala.linhas[0]!.extrasNoBancoMin).toBe(0);
  });
});
