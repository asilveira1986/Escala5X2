import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const dir = join(import.meta.dirname, '..');
export const dbUrl = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';

export async function conectarAdmin(): Promise<Client> {
  const c = new Client({ connectionString: dbUrl });
  await c.connect();
  return c;
}

/** Recria um banco limpo, aplica shim + migrations (up). */
export async function prepararBanco(): Promise<Client> {
  const admin = await conectarAdmin();
  await admin.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;');
  await admin.query(readFileSync(join(dir, 'test/supabase-shim.sql'), 'utf8'));
  await admin.query(readFileSync(join(dir, 'migrations/0001_fundacao.up.sql'), 'utf8'));
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
