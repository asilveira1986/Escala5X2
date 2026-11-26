import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { novoUsuario, prepararBanco } from '../../db/test/helpers';
import { carregarEntradaEscala, publicarEscala, validarEntrada } from '../src';
import { rpcPg, rpcPgServidor } from './pg-rpc';

let db: Client; let dono: string;
beforeAll(async () => {
  db = await prepararBanco();
  dono = await novoUsuario(db, 'dono');
  await db.query(readFileSync(join(import.meta.dirname, '../../db/seeds/dados_de_teste.sql'), 'utf8'));
});
afterAll(async () => { await db.end(); });

describe('escala dos dados fictícios', () => {
  it('não tem bloqueios e dá para publicar pelo fluxo normal do sistema', async () => {
    const id = (await db.query(`select id from escala where nome = 'Escala demo do mês'`)).rows[0].id as string;
    const entrada = await carregarEntradaEscala(rpcPg(db, dono, 'aal1'), id);
    const r = validarEntrada(entrada);
    expect(r.bloqueios, JSON.stringify(r.violacoes.filter((v) => v.severidade === 'bloqueio').slice(0, 5))).toBe(0);
    expect(r.podePublicar).toBe(true);
    await publicarEscala(rpcPg(db, dono, 'aal1'), rpcPgServidor(db), id, dono);
    expect((await db.query(`select status from escala where id = $1`, [id])).rows[0].status).toBe('publicada');
  });
});
