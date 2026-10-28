import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, migracoes, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let ana: string, bruno: string, carla: string, contador: string, superadm: string;
let orgA: string, orgB: string, orgContab: string, orgPlat: string;
let empA: string, empB: string;

async function criarOrg(uid: string, nome: string, tipo: string): Promise<string> {
  return comoUsuario(db, uid, async (c) => {
    const r = await c.query<{ id: string }>(`select criar_organizacao($1, $2::tipo_org) as id`, [nome, tipo]);
    return r.rows[0]!.id;
  });
}
async function criarEmpresa(uid: string, org: string, cnpj: string): Promise<string> {
  return comoUsuario(db, uid, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf)
       values ($1,'Empresa '||$2,$2,'medio','3550308','SP') returning id`, [org, cnpj]);
    return r.rows[0]!.id;
  });
}

beforeAll(async () => {
  db = await prepararBanco();
  ana = await novoUsuario(db, 'ana');
  bruno = await novoUsuario(db, 'bruno');
  carla = await novoUsuario(db, 'carla');
  contador = await novoUsuario(db, 'contador');
  superadm = await novoUsuario(db, 'super');
  orgA = await criarOrg(ana, 'Org A', 'empresa');
  orgB = await criarOrg(bruno, 'Org B', 'empresa');
  orgContab = await criarOrg(contador, 'Contab', 'contabilidade');
  empA = await criarEmpresa(ana, orgA, '11111111000111');
  empB = await criarEmpresa(bruno, orgB, '22222222000122');
  // plataforma + superadmin criados via service role (admin/superuser)
  const p = await db.query<{ id: string }>(`insert into organizacao (nome, tipo) values ('Plataforma','plataforma') returning id`);
  orgPlat = p.rows[0]!.id;
  await db.query(`insert into membro values ($1,$2,'superadmin')`, [orgPlat, superadm]);
  // carla: colaborador da org A (papel sem MFA obrigatório)
  await db.query(`insert into membro values ($1,$2,'rh')`, [orgA, carla]);
});
afterAll(async () => { await db.end(); });

describe('isolamento entre organizações', () => {
  it('usuário só enxerga a própria organização e empresas', async () => {
    const orgs = await comoUsuario(db, ana, (c) => c.query('select id from organizacao'));
    expect(orgs.rows.map((r) => r.id)).toEqual([orgA]);
    const emps = await comoUsuario(db, ana, (c) => c.query('select id from empresa'));
    expect(emps.rows.map((r) => r.id)).toEqual([empA]);
  });
  it('não lê empresa de outra organização por id', async () => {
    const r = await comoUsuario(db, ana, (c) => c.query('select * from empresa where id=$1', [empB]));
    expect(r.rowCount).toBe(0);
  });
  it('não insere empresa em outra organização', async () => {
    await expect(criarEmpresa(ana, orgB, '33333333000133')).rejects.toThrow(/row-level security/);
  });
  it('não altera nem apaga dados de outra organização', async () => {
    const u = await comoUsuario(db, ana, (c) => c.query(`update empresa set razao_social='x' where id=$1`, [empB]));
    expect(u.rowCount).toBe(0);
    const d = await comoUsuario(db, ana, (c) => c.query(`delete from empresa where id=$1`, [empB]));
    expect(d.rowCount).toBe(0);
  });
  it('não se auto-adiciona como membro de outra organização', async () => {
    await expect(comoUsuario(db, ana, (c) => c.query(`insert into membro values ($1,$2,'admin')`, [orgB, ana])))
      .rejects.toThrow(/row-level security/);
  });
  it('não lê membros nem auditoria de outra organização', async () => {
    const m = await comoUsuario(db, ana, (c) => c.query('select organizacao_id from membro'));
    expect(m.rows.every((r) => r.organizacao_id === orgA)).toBe(true);
    const a = await comoUsuario(db, ana, (c) => c.query('select distinct organizacao_id from auditoria'));
    expect(a.rows.map((r) => r.organizacao_id)).toEqual([orgA]);
  });
  it('anon não acessa nada', async () => {
    await db.query('begin');
    await db.query('set local role anon');
    await expect(db.query('select * from empresa')).rejects.toThrow(/permission denied/);
    await db.query('rollback');
  });
});

describe('papéis e MFA', () => {
  it('admin sem MFA (aal1) não enxerga dados', async () => {
    const r = await comoUsuario(db, ana, (c) => c.query('select id from empresa'), 'aal1');
    expect(r.rowCount).toBe(0);
  });
  it('RH (sem MFA obrigatório) acessa a empresa, mas não administra membros', async () => {
    const r = await comoUsuario(db, carla, (c) => c.query('select id from empresa'), 'aal1');
    expect(r.rows.map((x) => x.id)).toEqual([empA]);
    await expect(comoUsuario(db, carla, (c) => c.query(`insert into membro values ($1,$2,'rh')`, [orgA, bruno]), 'aal1'))
      .rejects.toThrow(/row-level security/);
  });
  it('usuário não consegue se promover a superadmin', async () => {
    await expect(comoUsuario(db, ana, (c) => c.query(`update membro set papel='superadmin' where usuario_id=$1`, [ana])))
      .rejects.toThrow(/row-level security/);
  });
  it('não cria organização do tipo plataforma', async () => {
    await expect(criarOrg(ana, 'Fake', 'plataforma')).rejects.toThrow(/plataforma/);
  });
});

describe('vínculo contábil (carteira)', () => {
  it('contador só vê a empresa do cliente após o vínculo, no nível concedido', async () => {
    const antes = await comoUsuario(db, contador, (c) => c.query('select id from empresa'));
    expect(antes.rowCount).toBe(0);
    await comoUsuario(db, ana, (c) => c.query(`insert into vinculo_empresa values ($1,$2,'leitura')`, [empA, orgContab]));
    const lê = await comoUsuario(db, contador, (c) => c.query('select id from empresa'));
    expect(lê.rows.map((r) => r.id)).toEqual([empA]);
    const edita = await comoUsuario(db, contador, (c) => c.query(`update empresa set cnae='4711' where id=$1`, [empA]));
    expect(edita.rowCount).toBe(0); // leitura não edita
    await comoUsuario(db, ana, (c) => c.query(`update vinculo_empresa set nivel='gestao' where empresa_id=$1`, [empA]));
    const edita2 = await comoUsuario(db, contador, (c) => c.query(`update empresa set cnae='4711' where id=$1`, [empA]));
    expect(edita2.rowCount).toBe(1);
    const outra = await comoUsuario(db, contador, (c) => c.query('select 1 from empresa where id=$1', [empB]));
    expect(outra.rowCount).toBe(0);
  });
});

describe('suporte do superadmin', () => {
  it('sem concessão não vê dados de clientes', async () => {
    const r = await comoUsuario(db, superadm, (c) => c.query('select id from empresa where id=$1', [empB]));
    expect(r.rowCount).toBe(0);
  });
  it('exige motivo e prazo; com concessão vigente enxerga e fica auditado', async () => {
    await expect(comoUsuario(db, superadm, (c) => c.query(
      `insert into acesso_suporte (superadmin_id, organizacao_id, motivo, expira_em) values ($1,$2,'curto',now()+interval '1 hour')`, [superadm, orgB])))
      .rejects.toThrow();
    await comoUsuario(db, superadm, (c) => c.query(
      `insert into acesso_suporte (superadmin_id, organizacao_id, motivo, expira_em) values ($1,$2,'Chamado 123: erro na escala',now()+interval '1 hour')`, [superadm, orgB]));
    const r = await comoUsuario(db, superadm, (c) => c.query('select id from empresa where id=$1', [empB]));
    expect(r.rowCount).toBe(1);
    const a = await db.query(`select 1 from auditoria where tabela='acesso_suporte' and organizacao_id=$1`, [orgB]);
    expect(a.rowCount).toBe(1);
  });
  it('concessão expirada deixa de valer', async () => {
    await db.query(`update acesso_suporte set expira_em = now() - interval '1 second', criado_em = now() - interval '1 hour' where organizacao_id=$1`, [orgB]);
    const r = await comoUsuario(db, superadm, (c) => c.query('select id from empresa where id=$1', [empB]));
    expect(r.rowCount).toBe(0);
  });
});

describe('auditoria imutável', () => {
  it('registra insert/update/delete com antes/depois e usuário', async () => {
    const e = await criarEmpresa(ana, orgA, '44444444000144');
    await comoUsuario(db, ana, (c) => c.query(`update empresa set cnae='1234' where id=$1`, [e]));
    await comoUsuario(db, ana, (c) => c.query(`delete from empresa where id=$1`, [e]));
    const r = await db.query(`select acao, antes, depois, usuario_id from auditoria where tabela='empresa' and registro_id=$1 order by id`, [e]);
    expect(r.rows.map((x) => x.acao)).toEqual(['insert', 'update', 'delete']);
    expect(r.rows[1].antes.cnae).toBeNull();
    expect(r.rows[1].depois.cnae).toBe('1234');
    expect(r.rows.every((x) => x.usuario_id === ana)).toBe(true);
  });
  it('bloqueia update, delete e truncate — até para o dono', async () => {
    await expect(db.query(`update auditoria set acao='x'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from auditoria`)).rejects.toThrow(/append-only/);
    await expect(db.query(`truncate auditoria`)).rejects.toThrow(/append-only/);
  });
  it('usuário autenticado não escreve na auditoria', async () => {
    await expect(comoUsuario(db, ana, (c) => c.query(`delete from auditoria`))).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(db, ana, (c) => c.query(
      `insert into auditoria (organizacao_id, tabela, registro_id, acao, hash) values ($1,'x','1','insert','h')`, [orgA]))).rejects.toThrow(/permission denied/);
  });
  it('cadeia de hash é íntegra por organização', async () => {
    const { rows } = await db.query(`select id, hash, hash_anterior from auditoria where organizacao_id=$1 order by id`, [orgA]);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows[0].hash_anterior).toBeNull();
    for (let i = 1; i < rows.length; i++) expect(rows[i].hash_anterior).toBe(rows[i - 1].hash);
  });
});

describe('migrations reversíveis', () => {
  it('down (em ordem inversa) remove tudo e up reaplica', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(import.meta.dirname, '../migrations');
    for (const f of [...migracoes].reverse()) await db.query(readFileSync(join(dir, `${f}.down.sql`), 'utf8'));
    const t = await db.query(`select count(*)::int n from information_schema.tables where table_schema='public'`);
    expect(t.rows[0].n).toBe(0);
    for (const f of migracoes) await db.query(readFileSync(join(dir, `${f}.up.sql`), 'utf8'));
  });
});
