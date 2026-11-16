import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let adm: string, outro: string, org: string, emp: string, c1: string, c2: string, esc: string;
const salvar = (uid: string, rev: number, lista: unknown[], escala = esc) =>
  comoUsuario(db, uid, async (c) => (await c.query<{ r: number }>(`select salvar_alocacoes($1,$2,$3::jsonb) r`, [escala, rev, JSON.stringify(lista)])).rows[0]!.r);
const t = (colaboradorId: string, data: string, ini = 480, fim = 1020, intervaloMin = 60) => ({ colaboradorId, data, tipo: 'trabalho', inicioMin: ini, fimMin: fim, intervaloMin });
const rev = async () => (await db.query(`select revisao from escala where id=$1`, [esc])).rows[0].revisao as number;

beforeAll(async () => {
  db = await prepararBanco();
  adm = await novoUsuario(db, 'adm'); outro = await novoUsuario(db, 'outro');
  org = await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, outro, (c) => c.query(`select criar_organizacao('B','empresa')`));
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01') returning id`, [emp, n, cpf])).rows[0].id as string;
  c1 = await mk('A', '1'); c2 = await mk('B', '2');
  esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'x','[2027-01-04,2027-02-01)',$2) returning id`, [emp, adm])).rows[0].id;
});
afterAll(async () => { await db.end(); });

describe('salvar_alocacoes', () => {
  it('grava a grade inteira e devolve a nova revisão', async () => {
    const r0 = await rev();
    const r1 = await salvar(adm, r0, [t(c1, '2027-01-04'), t(c1, '2027-01-05'), { colaboradorId: c2, data: '2027-01-04', tipo: 'folga' }]);
    expect(r1).toBeGreaterThan(r0);
    expect(r1).toBe(await rev());
    expect((await db.query(`select count(*)::int n from alocacao where escala_id=$1`, [esc])).rows[0].n).toBe(3);
  });
  it('grava só a diferença: o que não mudou não é tocado nem auditado de novo', async () => {
    const antes = (await db.query(`select count(*)::int n from auditoria where tabela='alocacao'`)).rows[0].n;
    const ids = (await db.query(`select id from alocacao where colaborador_id=$1 and data='2027-01-04'`, [c1])).rows[0].id;
    await salvar(adm, await rev(), [t(c1, '2027-01-04'), t(c1, '2027-01-05'), t(c1, '2027-01-06'), { colaboradorId: c2, data: '2027-01-04', tipo: 'folga' }]);
    const depois = (await db.query(`select count(*)::int n from auditoria where tabela='alocacao'`)).rows[0].n;
    expect(depois - antes).toBe(1); // só a inclusão de 06/01
    expect((await db.query(`select id from alocacao where colaborador_id=$1 and data='2027-01-04'`, [c1])).rows[0].id).toBe(ids);
  });
  it('troca e remove: alterar o horário substitui a linha; omitir remove', async () => {
    await salvar(adm, await rev(), [t(c1, '2027-01-04', 600, 1080)]);
    const r = await db.query(`select colaborador_id, data::text, inicio_min, fim_min from alocacao where escala_id=$1`, [esc]);
    expect(r.rows).toEqual([{ colaborador_id: c1, data: '2027-01-04', inicio_min: 600, fim_min: 1080 }]);
    await salvar(adm, await rev(), []);
    expect((await db.query(`select count(*)::int n from alocacao where escala_id=$1`, [esc])).rows[0].n).toBe(0);
  });
  it('trava otimista: revisão velha é recusada e nada é gravado', async () => {
    const velha = await rev();
    await salvar(adm, velha, [t(c1, '2027-01-04')]);
    await expect(salvar(adm, velha, [t(c1, '2027-01-05')])).rejects.toThrow(/alterada por outra pessoa/);
    expect((await db.query(`select data::text from alocacao where escala_id=$1`, [esc])).rows).toEqual([{ data: '2027-01-04' }]);
  });
  it('é atômico: um turno inválido desfaz a gravação inteira', async () => {
    const r = await rev();
    await expect(salvar(adm, r, [t(c1, '2027-01-05'), t(c1, '2027-01-06', 900, 800)])).rejects.toThrow();
    expect(await rev()).toBe(r);
    expect((await db.query(`select data::text from alocacao where escala_id=$1`, [esc])).rows).toEqual([{ data: '2027-01-04' }]);
    await expect(salvar(adm, r, [t(c1, '2027-01-05', 1320, 1800), t(c1, '2027-01-06', 300, 700)])).rejects.toThrow(); // sobreposição
  });
  it('recusa quem não gere a empresa, colaborador de outra empresa e data fora do período', async () => {
    await expect(salvar(outro, await rev(), [t(c1, '2027-01-04')])).rejects.toThrow(/não encontrada|sem permissão/);
    await expect(salvar(adm, await rev(), [t(c1, '2027-03-01')])).rejects.toThrow(/fora do período/);
    await expect(salvar(adm, await rev(), 'x' as never)).rejects.toThrow();
  });
  it('escala publicada não aceita gravação', async () => {
    const r = await rev();
    await db.query('begin'); await db.query(`select set_config('app.publicando','1',true)`);
    await db.query(`update escala set status='publicada', publicada_em=now(), hash_publicado='h' where id=$1`, [esc]);
    await db.query('commit');
    await expect(salvar(adm, r, [])).rejects.toThrow(/imutável|não encontrada/);
  });
});
