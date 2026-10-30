import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const dir = join(import.meta.dirname, '..');
const urlBase = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';

/** Cada pacote de testes usa o próprio banco (jc_test_<pacote>): o turbo roda os pacotes em paralelo. */
const nomeBanco = `jc_test_${(process.cwd().split('/').pop() ?? 'db').replace(/\W/g, '_')}`;
export const dbUrl = (() => { const u = new URL(urlBase); u.pathname = `/${nomeBanco}`; return u.toString(); })();

async function garantirBanco(): Promise<void> {
  const c = new Client({ connectionString: urlBase });
  await c.connect();
  try {
    const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [nomeBanco]);
    if (!rowCount) await c.query(`create database "${nomeBanco}"`);
  } catch (e) {
    if (!/already exists|duplicate/i.test(String(e))) throw e; // corrida entre pacotes
  } finally {
    await c.end();
  }
}

/** Segredo de teste; em produção vem do Vault. */
export const migracoes = ['0001_fundacao', '0002_cadastros_regras', '0003_storage'];

export async function conectarAdmin(): Promise<Client> {
  await garantirBanco();
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  return c;
}

/** Recria um banco limpo, aplica shim + migrations (up). */
export async function prepararBanco(): Promise<Client> {
  const admin = await conectarAdmin();
  await admin.query('drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; create schema public;');
  await admin.query(readFileSync(join(dir, 'test/supabase-shim.sql'), 'utf8'));
  await admin.query(`select set_config('app.chave_dados', 'chave-de-teste', false)`);
  for (const f of migracoes) await admin.query(readFileSync(join(dir, 'migrations', `${f}.up.sql`), 'utf8'));
  for (const f of ['regras', 'feriados']) await admin.query(readFileSync(join(dir, 'seeds', `${f}.sql`), 'utf8'));
  return admin;
}

export async function novoUsuario(admin: Client, nome: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`, [`${nome}@teste.com`]);
  const id = rows[0]!.id;
  await admin.query(`insert into usuario (id, nome, email) values ($1,$2,$3)`, [id, nome, `${nome}@teste.com`]);
  return id;
}

/** Executa como o usuário (role authenticated + claims JWT) dentro de uma transação; em erro faz rollback. */
export async function comoUsuario<T>(admin: Client, uid: string, fn: (c: Client) => Promise<T>, aal: 'aal1' | 'aal2' = 'aal2'): Promise<T> {
  await admin.query('begin');
  try {
    await admin.query(`set local role authenticated`);
    await admin.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, aal })]);
    const r = await fn(admin);
    await admin.query('commit');
    return r;
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
}
