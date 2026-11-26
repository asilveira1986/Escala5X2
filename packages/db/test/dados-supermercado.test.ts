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

describe('supermercado fictício', () => {
  it('cria 60 colaboradores em 6 setores, cobertura de segunda a sábado e domingo em duas faixas', async () => {
    await db.query(sql('dados_supermercado.sql'));
    expect(await n('colaborador')).toBe(60);
    const setores = await db.query(`select s.nome, count(c.id)::int q from setor s left join colaborador c on c.setor_id = s.id group by s.nome order by s.nome`);
    expect(Object.fromEntries(setores.rows.map((r) => [r.nome, r.q]))).toEqual({ 'Açougue': 8, 'Caixas': 18, 'Empacotadores': 8, 'Fruteira': 6, 'Padaria': 8, 'Repositores': 12 });
    const dom = await db.query(`select distinct faixa_inicio_min, faixa_fim_min from demanda_cobertura where dia_semana = 0 order by 1`);
    expect(dom.rows).toEqual([{ faixa_inicio_min: 480, faixa_fim_min: 720 }, { faixa_inicio_min: 960, faixa_fim_min: 1260 }]);
    const seg = await db.query(`select distinct faixa_inicio_min from demanda_cobertura where dia_semana between 1 and 6 order by 1`);
    expect(seg.rows.map((r) => r.faixa_inicio_min)).toEqual([480, 720, 960]);
    expect((await db.query(`select max(faixa_fim_min) m from demanda_cobertura where dia_semana between 1 and 6`)).rows[0].m).toBe(1260);
    expect(await n('ausencia')).toBe(3);
    expect(await n('turno_modelo')).toBe(6);
    expect((await db.query(`select status from escala`)).rows).toEqual([{ status: 'rascunho' }]);
  });
  it('rodar de novo não duplica e a remoção apaga tudo', async () => {
    await db.query(sql('dados_supermercado.sql'));
    expect(await n('colaborador')).toBe(60);
    await db.query(sql('remover_dados_de_teste.sql'));
    for (const t of ['empresa', 'colaborador', 'escala', 'alocacao', 'demanda_cobertura']) expect(await n(t), t).toBe(0);
  });
});
