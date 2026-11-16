import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, novoUsuario, prepararBanco } from '../../db/test/helpers';
import {
  analisarImpacto, aplicarTroca, aprovarAusencia, aprovarTroca, carregarEntradaEscala, preverSolicitacao, recusarSolicitacao, turnosEmConflito, validarEscalaSalva,
  type AlocacaoComModelo, type SolicitacaoLinha,
} from '../src';
import { entrada } from './otimizador-util';
import { rpcPg, rpcPgServidor } from './pg-rpc';

const manha = (c: string, data: string, extra: Partial<AlocacaoComModelo> = {}): AlocacaoComModelo => ({ colaboradorId: c, data, tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60, ...extra });
const tarde = (c: string, data: string): AlocacaoComModelo => ({ colaboradorId: c, data, tipo: 'trabalho', inicioMin: 720, fimMin: 1260, intervaloMin: 60 });
const folga = (c: string, data: string): AlocacaoComModelo => ({ colaboradorId: c, data, tipo: 'folga' });
const sol = (extra: Partial<SolicitacaoLinha>): SolicitacaoLinha => ({
  id: 's', empresa_id: 'emp', solicitante_id: 'A', destinatario_id: 'B', solicitante_nome: 'Ana', destinatario_nome: 'Bia', tipo: 'troca_turno', payload: {}, motivo: null, status: 'pendente', decisao_motivo: null, criado_em: '', ...extra,
});

describe('aplicarTroca (lógica pura)', () => {
  const base = [manha('A', '2027-02-01'), folga('A', '2027-02-02'), folga('B', '2027-02-01'), tarde('B', '2027-02-02')];
  it('troca de turno em dias diferentes: cada um assume o turno do outro e o dia que cedeu vira folga', () => {
    const r = aplicarTroca(base, sol({ payload: { escalaId: 'e', dataSolicitante: '2027-02-01', dataColega: '2027-02-02' } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const por = (c: string, d: string) => r.alocacoes.filter((a) => a.colaboradorId === c && a.data === d);
    expect(por('B', '2027-02-01')).toEqual([expect.objectContaining({ tipo: 'trabalho', inicioMin: 480, fimMin: 1020 })]);   // Bia assume a manhã da Ana
    expect(por('A', '2027-02-02')).toEqual([expect.objectContaining({ tipo: 'trabalho', inicioMin: 720, fimMin: 1260 })]);   // Ana assume a tarde da Bia
    expect(por('A', '2027-02-01')).toEqual([{ colaboradorId: 'A', data: '2027-02-01', tipo: 'folga' }]);
    expect(por('B', '2027-02-02')).toEqual([{ colaboradorId: 'B', data: '2027-02-02', tipo: 'folga' }]);
    expect(r.alocacoes).toHaveLength(4);                                                 // nenhuma célula duplicada ou perdida
    expect(r.resumo).toContain('Bia assume o turno de 01/02/2027 de Ana');
  });
  it('troca de turno no mesmo dia: os horários se cruzam', () => {
    const mesmo = [manha('A', '2027-02-01'), tarde('B', '2027-02-01')];
    const r = aplicarTroca(mesmo, sol({ payload: { escalaId: 'e', dataSolicitante: '2027-02-01', dataColega: '2027-02-01' } }));
    expect(r.ok && r.alocacoes.find((a) => a.colaboradorId === 'A')).toMatchObject({ inicioMin: 720, fimMin: 1260 });
    expect(r.ok && r.alocacoes.find((a) => a.colaboradorId === 'B')).toMatchObject({ inicioMin: 480, fimMin: 1020 });
  });
  it('mantém o modelo de turno de origem', () => {
    const com = [manha('A', '2027-02-01', { modeloId: 'm1' }), folga('B', '2027-02-01'), tarde('B', '2027-02-02'), folga('A', '2027-02-02')];
    const r = aplicarTroca(com, sol({ payload: { escalaId: 'e', dataSolicitante: '2027-02-01', dataColega: '2027-02-02' } }));
    expect(r.ok && r.alocacoes.find((a) => a.colaboradorId === 'B' && a.data === '2027-02-01')).toMatchObject({ modeloId: 'm1' });
  });
  it('recusa quando a escala mudou: turno sumiu, colega já trabalha no dia, solicitante já trabalha no dia do colega', () => {
    const p = { escalaId: 'e', dataSolicitante: '2027-02-01', dataColega: '2027-02-02' };
    expect(aplicarTroca([folga('A', '2027-02-01'), tarde('B', '2027-02-02')], sol({ payload: p }))).toMatchObject({ ok: false, erro: expect.stringMatching(/Ana não tem mais um turno/) });
    expect(aplicarTroca([manha('A', '2027-02-01')], sol({ payload: p }))).toMatchObject({ ok: false, erro: expect.stringMatching(/Bia não tem mais um turno/) });
    expect(aplicarTroca([manha('A', '2027-02-01'), manha('B', '2027-02-01'), tarde('B', '2027-02-02')], sol({ payload: p }))).toMatchObject({ ok: false, erro: expect.stringMatching(/Bia já trabalha em 01\/02\/2027/) });
    expect(aplicarTroca([manha('A', '2027-02-01'), manha('A', '2027-02-02'), tarde('B', '2027-02-02')], sol({ payload: p }))).toMatchObject({ ok: false, erro: expect.stringMatching(/Ana já trabalha em 02\/02\/2027/) });
    expect(aplicarTroca([manha('A', '2027-02-01'), tarde('B', '2027-02-02')], sol({ destinatario_id: null, payload: p }))).toMatchObject({ ok: false });
  });
  it('troca de folga: o turno muda de dia e o dia antigo vira folga', () => {
    const alocs = [manha('A', '2027-02-03', { modeloId: 'm1' }), folga('A', '2027-02-04')];
    const r = aplicarTroca(alocs, sol({ tipo: 'troca_folga', destinatario_id: null, destinatario_nome: null, payload: { escalaId: 'e', trabalharEm: '2027-02-04', folgarEm: '2027-02-03' } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.alocacoes.find((a) => a.data === '2027-02-04')).toMatchObject({ tipo: 'trabalho', inicioMin: 480, modeloId: 'm1' });
    expect(r.alocacoes.find((a) => a.data === '2027-02-03')).toMatchObject({ tipo: 'folga' });
    expect(r.alocacoes).toHaveLength(2);
    expect(aplicarTroca(alocs, sol({ tipo: 'troca_folga', destinatario_id: null, payload: { escalaId: 'e', trabalharEm: '2027-02-03', folgarEm: '2027-02-04' } }))).toMatchObject({ ok: false });
  });
  it('férias e afastamento não são trocas', () => {
    expect(aplicarTroca(base, sol({ tipo: 'ferias' }))).toMatchObject({ ok: false });
  });
});

describe('analisarImpacto: só conta o que a mudança introduz', () => {
  const seg = (i: number) => `2027-02-0${1 + i}`;
  const semana = (c: string, dias: number[]) => dias.map((i) => manha(c, seg(i)));
  it('troca inofensiva não gera nada; a que cria 6º dia de trabalho gera bloqueio', () => {
    const e = entrada({ alocacoes: semana('a', [0, 1, 2, 3, 4]) }, '2027-02-01', '2027-02-07');
    expect(analisarImpacto(e, [...e.alocacoes.slice(1), manha('a', seg(5))]).bloqueios).toBe(0);                // troca a segunda pelo sábado: segue 5 dias
    const ruim = analisarImpacto(e, [...e.alocacoes, manha('a', seg(5))]);
    expect(ruim.bloqueios).toBeGreaterThan(0);
    expect(ruim.novas.map((v) => v.codigo)).toContain('FOLGAS_SEMANA');
  });
  it('problemas que já existiam antes não são atribuídos à troca', () => {
    const e = entrada({ alocacoes: semana('a', [0, 1, 2, 3, 4, 5]) }, '2027-02-01', '2027-02-07');     // já com 6 dias: bloqueado desde o começo
    const r = analisarImpacto(e, [...e.alocacoes.slice(1), manha('a', seg(6))]);                         // troca de dia, continua com 6
    expect(r.bloqueios).toBe(0);
  });
  it('turnos em conflito com férias/afastamento', () => {
    const e = entrada({ alocacoes: semana('a', [0, 1, 2]) }, '2027-02-01', '2027-02-07');
    expect(turnosEmConflito(e, 'a', { inicio: '2027-02-02', fim: '2027-02-10' })).toEqual(['2027-02-02', '2027-02-03']);
    expect(turnosEmConflito(e, 'a', { inicio: '2027-02-05', fim: '2027-02-06' })).toEqual([]);
    expect(turnosEmConflito(e, 'outra', { inicio: '2027-02-01', fim: '2027-02-07' })).toEqual([]);
  });
});

describe('aprovação de ponta a ponta (banco real)', () => {
  let db: Client;
  let rh: string, ua: string, ub: string;
  let org: string, emp: string, A: string, B: string, esc: string;
  let hoje: string;
  const dia = (n: number) => new Date(Date.parse(`${hoje}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const servidor = () => rpcPgServidor(db);
  const cliente = () => rpcPg(db, rh);
  const linhaSol = async (id: string): Promise<SolicitacaoLinha> => (await db.query(`select * from solicitacao where id=$1`, [id])).rows[0] as SolicitacaoLinha;
  const criar = (uid: string, colab: string, tipo: string, payload: unknown, dest: string | null = null) =>
    comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(`select criar_solicitacao($1,$2,$3::jsonb,$4,null) id`, [colab, tipo, JSON.stringify(payload), dest])).rows[0]!.id);
  const aceitar = (uid: string, id: string) => comoUsuario(db, uid, (c) => c.query(`select responder_solicitacao($1,true)`, [id]));

  beforeAll(async () => {
    db = await prepararBanco();
    hoje = (await db.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
    rh = await novoUsuario(db, 'rh'); ua = await novoUsuario(db, 'ua'); ub = await novoUsuario(db, 'ub');
    org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
    for (const u of [ua, ub]) await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, u]);
    emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
    const mk = async (n: string, cpf: string, u: string) => {
      const id = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4) returning id`, [emp, n, cpf, u])).rows[0].id as string;
      await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1,'[2020-01-01,)',3000,2400,200,'5x2')`, [id]);
      return id;
    };
    A = await mk('Ana', '1', ua); B = await mk('Bia', '2', ub);
    // período de 2 semanas inteiras (segunda a domingo) começando numa segunda futura
    const d0 = new Date(`${dia(14)}T00:00:00Z`); d0.setUTCDate(d0.getUTCDate() + ((8 - d0.getUTCDay()) % 7));
    const ini = d0.toISOString().slice(0, 10);
    const somar = (n: number) => new Date(Date.parse(`${ini}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Quinzena',daterange($2::date,$3::date),$4) returning id`, [emp, ini, somar(14), rh])).rows[0].id;
    for (let i = 0; i < 14; i++) {
      const dd = somar(i); const util = i % 7 < 5;
      await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',480,1020,60)`.replace("'trabalho',480,1020,60", util ? "'trabalho',480,1020,60" : "'folga',null,null,0"), [esc, A, dd]);
      // Bia faz 12h–21h na 1ª semana e 14h–23h na 2ª
      const [bi, bf] = i < 7 ? [720, 1260] : [840, 1380];
      await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',${bi},${bf},60)`.replace(`'trabalho',${bi},${bf},60`, util ? `'trabalho',${bi},${bf},60` : "'folga',null,null,0"), [esc, B, dd]);
    }
    (globalThis as Record<string, unknown>).__ini = ini;
    // publica pelo servidor (caminho real)
    const { publicarEscala } = await import('../src');
    await publicarEscala(cliente(), servidor(), esc, rh);
  });
  afterAll(async () => { await db.end(); });
  const ini = () => (globalThis as Record<string, unknown>).__ini as string;
  const somar = (n: number) => new Date(Date.parse(`${ini()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  it('troca de turno aprovada: nova versão publicada com a troca; a anterior fica substituída; decisão registrada', async () => {
    const id = await criar(ua, A, 'troca_turno', { escalaId: esc, dataSolicitante: somar(1), dataColega: somar(1) }, B);   // mesmo dia: manhã ↔ tarde
    await aceitar(ub, id);
    const prev = await preverSolicitacao(cliente(), await linhaSol(id));
    expect(prev.erro).toBeUndefined();
    expect(prev.resumo).toMatch(/trocam de turno/);
    expect(prev.impacto!.bloqueios).toBe(0);
    const r = await aprovarTroca(cliente(), servidor(), await linhaSol(id), rh);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const novaId = r.novaEscalaId!;
    const v = (await db.query(`select id, status, versao from escala where empresa_id=$1 and periodo = (select periodo from escala where id=$2) order by versao`, [emp, esc])).rows;
    expect(v.map((x) => [x.status, x.versao])).toEqual([['substituida', 1], ['publicada', 2]]);
    expect(v[1].id).toBe(novaId);
    const nova = await carregarEntradaEscala(cliente(), novaId);
    const cel = (c: string, d: string) => nova.alocacoes.filter((a) => a.colaboradorId === c && a.data === d);
    expect(cel(B, somar(1))[0]).toMatchObject({ tipo: 'trabalho', inicioMin: 480 });      // Bia assumiu a manhã da Ana
    expect(cel(A, somar(1))[0]).toMatchObject({ tipo: 'trabalho', inicioMin: 720 });      // Ana assumiu a tarde da Bia
    expect((await validarEscalaSalva(cliente(), novaId)).bloqueios).toBe(0);
    const s = (await db.query(`select status, decidido_por, validacao from solicitacao where id=$1`, [id])).rows[0];
    expect(s).toMatchObject({ status: 'aprovada', decidido_por: rh });
    expect(s.validacao).toMatchObject({ bloqueios: 0, novaEscalaId: novaId });
    // o colaborador enxerga a versão nova; a antiga some
    expect((await comoUsuario(db, ub, (c) => c.query(`select 1 from alocacao where escala_id=$1`, [novaId]))).rowCount).toBeGreaterThan(0);
    expect((await comoUsuario(db, ub, (c) => c.query(`select 1 from alocacao where escala_id=$1`, [esc]))).rowCount).toBe(0);
  });

  it('segundo pedido sobre a versão antiga é aplicado na versão vigente (e não troca o que já mudou)', async () => {
    // pedido feito sobre a escala ORIGINAL (já substituída): Ana ↔ Bia em outro dia
    const id = await criar(ub, B, 'troca_folga', { escalaId: (await db.query(`select id from escala where status='publicada' and empresa_id=$1`, [emp])).rows[0].id, trabalharEm: somar(5), folgarEm: somar(3) });
    // aponta o pedido para a versão antiga para provar o redirecionamento
    await db.query(`update solicitacao set payload = jsonb_set(payload, '{escalaId}', to_jsonb($2::text)) where id=$1`, [id, esc]);
    const r = await aprovarTroca(cliente(), servidor(), await linhaSol(id), rh);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const versoes = (await db.query(`select status, versao from escala where empresa_id=$1 order by versao`, [emp])).rows;
    expect(versoes.map((x) => [x.status, x.versao])).toEqual([['substituida', 1], ['substituida', 2], ['publicada', 3]]);
  });

  it('a troca que violaria a lei é recusada pelo motor e nada é gravado', async () => {
    const antes = (await db.query(`select count(*)::int n from escala where empresa_id=$1`, [emp])).rows[0].n;
    const vigente = (await db.query(`select id from escala where status='publicada' and empresa_id=$1`, [emp])).rows[0].id as string;
    // 2ª semana: Bia fecha às 23h. Se Ana assumir esse turno e voltar de manhã, sobram só 9h entre os turnos (mínimo 11h).
    const id = await criar(ua, A, 'troca_turno', { escalaId: vigente, dataSolicitante: somar(8), dataColega: somar(8) }, B);
    await aceitar(ub, id);
    const prev = await preverSolicitacao(cliente(), await linhaSol(id));
    expect(prev.impacto!.bloqueios).toBeGreaterThan(0);
    expect(prev.impacto!.novas.map((v) => v.codigo)).toContain('INTERJORNADA');
    const r = await aprovarTroca(cliente(), servidor(), await linhaSol(id), rh);
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/violaria a lei/) });
    expect((await db.query(`select count(*)::int n from escala where empresa_id=$1`, [emp])).rows[0].n).toBe(antes);   // nenhuma versão nova ficou no banco
    expect((await db.query(`select status from solicitacao where id=$1`, [id])).rows[0].status).toBe('pendente');      // segue pendente: o RH decide (recusar)
    expect(await recusarSolicitacao(cliente(), id, 'Violaria o intervalo entre jornadas')).toEqual({ ok: true });
  });

  it('sem a chave de serviço (servidor nulo) a troca não é aprovada', async () => {
    const lin = sol({ id: 'y', status: 'pendente', tipo: 'troca_folga', destinatario_id: null, payload: { escalaId: esc, trabalharEm: somar(5), folgarEm: somar(4) } });
    expect(await aprovarTroca(cliente(), null, lin, rh)).toMatchObject({ ok: false, erro: expect.stringMatching(/SUPABASE_SERVICE_ROLE_KEY/) });
  });

  it('pedido que não está pendente ou de outro tipo é recusado', async () => {
    expect(await aprovarTroca(cliente(), servidor(), sol({ status: 'aguardando_colega' }), rh)).toMatchObject({ ok: false, erro: expect.stringMatching(/não está pendente/) });
    expect(await aprovarTroca(cliente(), servidor(), sol({ tipo: 'ferias' }), rh)).toMatchObject({ ok: false, erro: expect.stringMatching(/não é uma troca/) });
    expect(await aprovarAusencia(cliente(), sol({ tipo: 'troca_turno' }))).toMatchObject({ ok: false });
  });

  it('férias aprovadas lançam a ausência; a prévia avisa dos turnos em conflito na escala vigente', async () => {
    const id = await criar(ua, A, 'ferias', { inicio: somar(9), fim: somar(11) });
    const lin = await linhaSol(id);
    const prev = await preverSolicitacao(cliente(), lin);
    expect(prev.conflitos).toEqual([somar(9), somar(10), somar(11)].filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() % 6 !== 0));
    const r = await aprovarAusencia(cliente(), lin, prev.conflitos);
    expect(r.ok).toBe(true);
    expect(r.ok && r.relatorio.alertas).toBe(1);
    const aus = (await db.query(`select tipo, lower(periodo)::text i from ausencia where colaborador_id=$1`, [A])).rows;
    expect(aus).toEqual([{ tipo: 'ferias', i: somar(9) }]);
  });

  it('recusar exige motivo e só o RH decide', async () => {
    const id = await criar(ub, B, 'ferias', { inicio: dia(400), fim: dia(405) });
    expect(await recusarSolicitacao(cliente(), id, ' ')).toMatchObject({ ok: false, erro: expect.stringMatching(/motivo/) });
    expect(await recusarSolicitacao(rpcPg(db, ua), id, 'sem permissão aqui')).toMatchObject({ ok: false, erro: expect.stringMatching(/sem permissão/) });
    expect(await recusarSolicitacao(cliente(), id, 'Pico de vendas')).toEqual({ ok: true });
    expect((await linhaSol(id)).decisao_motivo).toBe('Pico de vendas');
  });
});
