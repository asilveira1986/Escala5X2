import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, novoUsuario, prepararBanco } from '../../db/test/helpers';
import { acordo, colab } from '../../rules-engine/test/util';
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
  it('colaborador não consegue ler a base do fechamento nem fechar', async () => {
    await expect(carregarBaseFechamento(rpcPg(db, ua), emp, ini())).rejects.toThrow(/sem permissão/);
  });
});
