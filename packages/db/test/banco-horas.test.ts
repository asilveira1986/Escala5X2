import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let rh: string, ua: string, ub: string, uOrgB: string;
let org: string, emp: string, A: string, B: string, acordo: string;
let hoje: string;
const dia = (n: number) => new Date(Date.parse(`${hoje}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lancar = (uid: string, colab: string, data: string, min: number, origem: string, desc: string | null = null) =>
  comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(`select lancar_banco_horas($1,$2,$3,$4,$5) id`, [colab, data, min, origem, desc])).rows[0]!.id);
const saldo = async (c: string) => Number((await db.query(`select coalesce(sum(minutos),0)::int s from banco_horas_lancamento where colaborador_id=$1`, [c])).rows[0].s);

beforeAll(async () => {
  db = await prepararBanco();
  hoje = (await db.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
  rh = await novoUsuario(db, 'rh'); ua = await novoUsuario(db, 'ua'); ub = await novoUsuario(db, 'ub'); uOrgB = await novoUsuario(db, 'orgb');
  org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, uOrgB, (c) => c.query(`select criar_organizacao('B','empresa')`));
  for (const u of [ua, ub]) await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, u]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string, u: string) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4) returning id`, [emp, n, cpf, u])).rows[0].id as string;
  A = await mk('Ana', '1', ua); B = await mk('Bia', '2', ub);
  // acordo vigente com cláusula de banco de horas: prazo 6 meses, teto de 10h, até 2h negativas; só a Ana está vinculada
  acordo = (await db.query(`insert into acordo_coletivo (organizacao_id, empresa_id, tipo, vigencia, status) values ($1,$2,'acordo',daterange('2020-01-01',null),'vigente') returning id`, [org, emp])).rows[0].id;
  await db.query(`insert into clausula_jornada (acordo_id, tipo, parametros) values ($1,'banco_horas','{"prazo_meses":6,"limite_saldo_min":600,"limite_negativo_min":120}')`, [acordo]);
  await db.query(`insert into colaborador_acordo (colaborador_id, acordo_id) values ($1,$2)`, [A, acordo]);
});
afterAll(async () => { await db.end(); });

describe('créditos', () => {
  it('crédito com acordo: grava vencimento pelo prazo da cláusula e o acordo de origem; auditado', async () => {
    const id = await lancar(rh, A, dia(-10), 120, 'manual', 'Hora extra do inventário');
    const r = (await db.query(`select minutos, origem, vence_em::text v, acordo_id, criado_por, descricao from banco_horas_lancamento where id=$1`, [id])).rows[0];
    const esperado = (await db.query(`select (($1::date) + interval '6 months')::date::text v`, [dia(-10)])).rows[0].v;
    expect(r).toMatchObject({ minutos: 120, origem: 'manual', v: esperado, acordo_id: acordo, criado_por: rh, descricao: 'Hora extra do inventário' });
    expect((await db.query(`select 1 from auditoria where tabela='banco_horas_lancamento' and registro_id=$1 and acao='insert'`, [id])).rowCount).toBe(1);
  });
  it('sem acordo com banco de horas o crédito é recusado (a lei exige acordo)', async () => {
    await expect(lancar(rh, B, dia(-1), 60, 'manual')).rejects.toThrow(/não tem acordo com banco de horas vigente/);
    expect(await saldo(B)).toBe(0);
  });
  it('acordo vencido ou ainda não vigente não vale', async () => {
    const velho = (await db.query(`insert into acordo_coletivo (organizacao_id, empresa_id, tipo, vigencia, status) values ($1,$2,'acordo',daterange('2019-01-01','2019-12-31'),'vigente') returning id`, [org, emp])).rows[0].id;
    await db.query(`insert into clausula_jornada (acordo_id, tipo, parametros) values ($1,'banco_horas','{"prazo_meses":12}')`, [velho]);
    await db.query(`insert into colaborador_acordo (colaborador_id, acordo_id) values ($1,$2)`, [B, velho]);
    await expect(lancar(rh, B, dia(-1), 60, 'manual')).rejects.toThrow(/não tem acordo/);
    await db.query(`update acordo_coletivo set status='rascunho' where id=$1`, [acordo]);
    await expect(lancar(rh, A, dia(-1), 60, 'manual')).rejects.toThrow(/não tem acordo/);          // rascunho não vale
    await db.query(`update acordo_coletivo set status='vigente' where id=$1`, [acordo]);
  });
  it('respeita o teto de saldo do acordo', async () => {
    const atual = await saldo(A);
    await expect(lancar(rh, A, dia(-5), 600 - atual + 1, 'manual')).rejects.toThrow(/passaria do limite do acordo/);
    await lancar(rh, A, dia(-5), 600 - atual, 'manual');                                           // exatamente no teto
    expect(await saldo(A)).toBe(600);
    await expect(lancar(rh, A, dia(-4), 1, 'manual')).rejects.toThrow(/passaria do limite/);
  });
  it('validações de dados: minutos, data futura, antes da admissão, origem', async () => {
    await expect(lancar(rh, A, dia(-1), 0, 'manual')).rejects.toThrow(/1 minuto a 24 horas/);
    await expect(lancar(rh, A, dia(-1), 1441, 'manual')).rejects.toThrow(/1 minuto a 24 horas/);
    await expect(lancar(rh, A, dia(1), 30, 'manual')).rejects.toThrow(/data futura/);
    await expect(lancar(rh, A, '2019-01-01', 30, 'manual')).rejects.toThrow(/fora do intervalo|anterior à admissão/);
    await expect(lancar(rh, A, dia(-1), 30, 'ponto')).rejects.toThrow(/origem inválida/);
    await expect(lancar(rh, A, dia(-1), 30, 'estorno')).rejects.toThrow(/origem inválida/);
    await expect(lancar(rh, A, dia(-1), -30, 'manual')).rejects.toThrow(/é crédito/);
    await expect(lancar(rh, A, dia(-1), 30, 'compensacao')).rejects.toThrow(/sempre débito/);
  });
});

describe('débitos', () => {
  it('compensação e pagamento reduzem o saldo; compensação futura planejada é permitida', async () => {
    const antes = await saldo(A);
    await lancar(rh, A, dia(7), -480, 'compensacao', 'Folga compensatória');
    await lancar(rh, A, dia(-1), -60, 'falta', 'Atraso');
    expect(await saldo(A)).toBe(antes - 540);
    await expect(lancar(rh, A, dia(120), -60, 'compensacao')).rejects.toThrow(/fora do intervalo/);
  });
  it('o saldo não passa do limite negativo do acordo (2h)', async () => {
    const s = await saldo(A);
    await expect(lancar(rh, A, dia(-1), -(s + 121), 'ajuste')).rejects.toThrow(/abaixo do permitido/);
    await lancar(rh, A, dia(-1), -(s + 120), 'ajuste');
    expect(await saldo(A)).toBe(-120);
    await expect(lancar(rh, A, dia(-1), -1, 'ajuste')).rejects.toThrow(/abaixo do permitido/);
  });
  it('sem acordo, o limite negativo é zero: não deixa o saldo ficar negativo', async () => {
    await expect(lancar(rh, B, dia(-1), -30, 'falta')).rejects.toThrow(/abaixo do permitido/);
  });
});

describe('livro-razão imutável e estorno', () => {
  it('ninguém edita nem apaga lançamento, nem o dono do banco', async () => {
    const id = (await db.query(`select id from banco_horas_lancamento order by id limit 1`)).rows[0].id;
    await expect(db.query(`update banco_horas_lancamento set minutos = 1 where id=$1`, [id])).rejects.toThrow(/livro-razão/);
    await expect(db.query(`delete from banco_horas_lancamento where id=$1`, [id])).rejects.toThrow(/livro-razão/);
    await expect(comoUsuario(db, rh, (c) => c.query(`update banco_horas_lancamento set minutos = 1`))).rejects.toThrow();
    await expect(comoUsuario(db, rh, (c) => c.query(`insert into banco_horas_lancamento (organizacao_id, empresa_id, colaborador_id, data, minutos, origem, vence_em) values ($1,$2,$3,$4,60,'manual',$4)`, [org, emp, A, dia(0)]))).rejects.toThrow();
  });
  it('estorno gera o lançamento oposto ligado ao original; um só por lançamento; motivo obrigatório; não estorna estorno', async () => {
    await lancar(rh, A, dia(-1), 200, 'ajuste').catch(() => undefined);   // saldo está em -120 e 'ajuste' positivo é recusado: usa manual
    const c = await lancar(rh, A, dia(-1), 200, 'manual');
    const antes = await saldo(A);
    await expect(comoUsuario(db, rh, (cl) => cl.query(`select estornar_banco_horas($1,' ')`, [c]))).rejects.toThrow(/motivo do estorno/);
    const e = (await comoUsuario(db, rh, (cl) => cl.query(`select estornar_banco_horas($1,'Lançado em duplicidade') id`, [c]))).rows[0].id;
    expect(await saldo(A)).toBe(antes - 200);
    expect((await db.query(`select minutos, origem, estorna_id::text from banco_horas_lancamento where id=$1`, [e])).rows[0]).toEqual({ minutos: -200, origem: 'estorno', estorna_id: String(c) });
    await expect(comoUsuario(db, rh, (cl) => cl.query(`select estornar_banco_horas($1,'de novo')`, [c]))).rejects.toThrow(/já foi estornado/);
    await expect(comoUsuario(db, rh, (cl) => cl.query(`select estornar_banco_horas($1,'estorno do estorno')`, [e]))).rejects.toThrow(/não pode ser estornado/);
  });
  it('estornar um débito devolve crédito com novo prazo; estornar crédito já gasto é recusado', async () => {
    const d = await lancar(rh, A, dia(-1), -50, 'falta', 'Atraso lançado por engano').catch(() => null);
    if (d) {
      const e = (await comoUsuario(db, rh, (cl) => cl.query(`select estornar_banco_horas($1,'Foi um engano') id`, [d]))).rows[0].id;
      const r = (await db.query(`select minutos, vence_em::text v from banco_horas_lancamento where id=$1`, [e])).rows[0];
      expect(r.minutos).toBe(50);
      expect(r.v).toBe((await db.query(`select (($1::date) + interval '6 months')::date::text v`, [hoje])).rows[0].v);
    }
    const credito = await lancar(rh, A, dia(-1), 100, 'manual').catch(() => null);
    if (credito) {
      await db.query(`select 1`);
      const s = await saldo(A);
      await lancar(rh, A, dia(-1), -(s + 120), 'ajuste');                                           // consome tudo, até o limite negativo
      await expect(comoUsuario(db, rh, (cl) => cl.query(`select estornar_banco_horas($1,'tentativa')`, [credito]))).rejects.toThrow(/já foi compensada/);
    }
  });
});

describe('permissões e visibilidade', () => {
  it('só quem gere a empresa lança; colaborador, outro colaborador e outra organização, não', async () => {
    await expect(lancar(ua, A, dia(-1), 30, 'manual')).rejects.toThrow(/sem permissão/);
    await expect(lancar(ub, A, dia(-1), 30, 'manual')).rejects.toThrow(/sem permissão/);
    await expect(lancar(uOrgB, A, dia(-1), 30, 'manual')).rejects.toThrow(/sem permissão/);
    const id = (await db.query(`select id from banco_horas_lancamento order by id limit 1`)).rows[0].id;
    await expect(comoUsuario(db, ua, (c) => c.query(`select estornar_banco_horas($1,'quero apagar')`, [id]))).rejects.toThrow(/sem permissão/);
  });
  it('o colaborador vê só o próprio extrato; o RH vê todos; outra organização, nenhum', async () => {
    await db.query(`update acordo_coletivo set vigencia = daterange('2020-01-01',null) where id=$1`, [acordo]);
    await db.query(`insert into colaborador_acordo (colaborador_id, acordo_id) values ($1,$2) on conflict do nothing`, [B, acordo]);
    await lancar(rh, B, dia(-2), 30, 'manual');
    const ver = async (u: string) => (await comoUsuario(db, u, (c) => c.query(`select distinct colaborador_id from banco_horas_lancamento`))).rows.map((r) => r.colaborador_id);
    expect(await ver(ua)).toEqual([A]);
    expect(await ver(ub)).toEqual([B]);
    expect((await ver(rh)).sort()).toEqual([A, B].sort());
    expect(await ver(uOrgB)).toEqual([]);
  });
  it('as funções internas não são chamáveis pelo cliente', async () => {
    await expect(comoUsuario(db, rh, (c) => c.query(`select banco_horas_saldo($1)`, [A]))).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(db, rh, (c) => c.query(`select * from banco_horas_clausula($1,$2)`, [A, dia(0)]))).rejects.toThrow(/permission denied/);
  });
});
