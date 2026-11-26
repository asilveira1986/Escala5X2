import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { novoUsuario, prepararBanco } from './helpers';

const sql = (f: string) => readFileSync(join(import.meta.dirname, '..', 'seeds', f), 'utf8');
let db: Client;
beforeAll(async () => { db = await prepararBanco(); await novoUsuario(db, 'dono'); });
afterAll(async () => { await db.end(); });
const n = async (t: string) => Number((await db.query(`select count(*)::int c from ${t}`)).rows[0].c);
const demos = async () => Number((await db.query(`select count(*)::int c from organizacao where nome = 'Demo JornadaCerta'`)).rows[0].c);

describe('dados fictícios de teste', () => {
  it('cria a organização demo completa e a escala em rascunho', async () => {
    await db.query(sql('dados_de_teste.sql'));
    expect((await db.query(`select nome from organizacao`)).rows.map((r) => r.nome)).toContain('Demo JornadaCerta');
    expect(await n('empresa')).toBe(1);
    expect(await n('colaborador')).toBe(8);
    expect(await n('contrato_versao')).toBe(8);
    expect(await n('turno_modelo')).toBe(3);
    expect(await n('demanda_cobertura')).toBe(12);
    expect(await n('ausencia')).toBe(1);
    expect((await db.query(`select status from escala`)).rows).toEqual([{ status: 'rascunho' }]);
    expect(await n('alocacao')).toBeGreaterThan(150);
    const m = await db.query(`select papel from membro`);
    expect(m.rows).toEqual([{ papel: 'admin' }]);
  });
  it('rodar de novo não duplica', async () => {
    await db.query(sql('dados_de_teste.sql'));
    expect(await demos()).toBe(1);
    expect(await n('colaborador')).toBe(8);
  });
  it('o script de remoção apaga só a organização demo', async () => {
    await db.query(sql('remover_dados_de_teste.sql'));
    expect(await demos()).toBe(0);
    for (const t of ['empresa', 'colaborador', 'escala', 'alocacao', 'ausencia', 'turno_modelo']) expect(await n(t), t).toBe(0);
  });
});
