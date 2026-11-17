import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client; let adm: string, lider: string, estranho: string; let org: string, emp: string;
const q = <T = unknown>(uid: string, sql: string, p: unknown[] = []) => comoUsuario(db, uid, async (c) => (await c.query(sql, p)).rows as T[]);
let seq = 0;
const novoColab = async (adm_ = '2026-01-05') => {
  const cpf = String(10000000000 + ++seq);
  const id = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Ana',cifrar_texto($2),hash_cpf($2),$3) returning id`, [emp, cpf, adm_])).rows[0].id as string;
  await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1, daterange($2::date, null), 2000, 2640, 220, '6x1')`, [id, adm_]);
  return id;
};
const contratos = async (id: string) => (await db.query(`select vigencia::text v, salario_base::float s, tipo_escala t from contrato_versao where colaborador_id=$1 order by lower(vigencia)`, [id])).rows;
const alterar = (uid: string, id: string, data: string, sal = 2500, tipo = '5x2') =>
  q(uid, `select alterar_contrato($1,$2::date,$3::numeric,2640,220,$4,'Manhã',null::smallint,0)`, [id, data, sal, tipo]);

beforeAll(async () => {
  db = await prepararBanco();
  adm = await novoUsuario(db, 'adm'); lider = await novoUsuario(db, 'lider'); estranho = await novoUsuario(db, 'estranho');
  org = (await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id));
  await comoUsuario(db, estranho, (c) => c.query(`select criar_organizacao('B','empresa')`));
  await db.query(`insert into membro values ($1,$2,'lider')`, [org, lider]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
});
afterAll(async () => { await db.end(); });

describe('atualizar_colaborador', () => {
  it('muda os dados da pessoa, cria o setor novo e apaga o telefone vazio; o CPF não muda', async () => {
    const id = await novoColab();
    await q(adm, `select atualizar_colaborador($1,'  Ana Paula ','Padaria','M9','Padeira','514105','superior','11988887777')`, [id]);
    const c = (await db.query(`select c.nome, c.matricula, c.cargo, c.cbo, c.escolaridade, s.nome setor, decifrar_texto(c.telefone_cifrado) tel, decifrar_texto(c.cpf_cifrado) cpf from colaborador c join setor s on s.id=c.setor_id where c.id=$1`, [id])).rows[0];
    expect(c).toMatchObject({ nome: 'Ana Paula', matricula: 'M9', cargo: 'Padeira', cbo: '514105', escolaridade: 'superior', setor: 'Padaria', tel: '11988887777' });
    expect(c.cpf).toMatch(/^1000000000\d+$/);
    await q(adm, `select atualizar_colaborador($1,'Ana Paula',null,null,null,null,null,'')`, [id]);
    const d = (await db.query(`select setor_id, telefone_cifrado, matricula from colaborador where id=$1`, [id])).rows[0];
    expect(d).toEqual({ setor_id: null, telefone_cifrado: null, matricula: null });
  });
  it('recusa nome vazio, líder e gente de fora', async () => {
    const id = await novoColab();
    await expect(q(adm, `select atualizar_colaborador($1,' ')`, [id])).rejects.toThrow(/Nome obrigatório/);
    await expect(q(lider, `select atualizar_colaborador($1,'X')`, [id])).rejects.toThrow(/sem permissão/);
    await expect(q(estranho, `select atualizar_colaborador($1,'X')`, [id])).rejects.toThrow(/sem permissão/);
  });
});

describe('alterar_contrato', () => {
  it('encerra a versão atual na véspera e abre a nova, preservando o histórico', async () => {
    const id = await novoColab();
    await alterar(adm, id, '2026-06-01');
    expect(await contratos(id)).toEqual([{ v: '[2026-01-05,2026-06-01)', s: 2000, t: '6x1' }, { v: '[2026-06-01,)', s: 2500, t: '5x2' }]);
    await alterar(adm, id, '2026-09-01', 3000, '5x2');
    expect((await contratos(id)).map((x) => x.v)).toEqual(['[2026-01-05,2026-06-01)', '[2026-06-01,2026-09-01)', '[2026-09-01,)']);
    // sem sobreposição: a visão mostra exatamente um contrato por dia
    expect((await db.query(`select count(*)::int n from contrato_versao where colaborador_id=$1 and vigencia @> '2026-07-15'::date`, [id])).rows[0].n).toBe(1);
  });
  it('na mesma data de início, corrige a versão em vez de criar outra vazia', async () => {
    const id = await novoColab('2026-02-02');
    await alterar(adm, id, '2026-02-02', 2100);
    expect(await contratos(id)).toEqual([{ v: '[2026-02-02,)', s: 2100, t: '5x2' }]);
  });
  it('recusa data antes do contrato atual, antes da admissão, e salário inválido', async () => {
    const id = await novoColab('2026-02-02');
    await alterar(adm, id, '2026-05-01');
    await expect(alterar(adm, id, '2026-04-01')).rejects.toThrow(/anterior ao início do contrato atual/);
    await expect(alterar(adm, id, '2026-01-01')).rejects.toThrow(/anterior à admissão/);
    await expect(alterar(adm, id, '2026-06-01', 0)).rejects.toThrow();
    expect(await contratos(id)).toHaveLength(2);
  });
  it('só a gestão altera', async () => {
    const id = await novoColab();
    await expect(alterar(lider, id, '2026-06-01')).rejects.toThrow(/sem permissão/);
    await expect(alterar(estranho, id, '2026-06-01')).rejects.toThrow(/sem permissão/);
  });
});

describe('desligar_colaborador / reativar_colaborador', () => {
  it('registra a data, encerra o contrato no último dia e some do contrato vigente depois dela', async () => {
    const id = await novoColab();
    await q(adm, `select desligar_colaborador($1,'2026-08-31')`, [id]);
    expect((await db.query(`select desligamento::text d from colaborador where id=$1`, [id])).rows[0].d).toBe('2026-08-31');
    expect((await contratos(id)).map((x) => x.v)).toEqual(['[2026-01-05,2026-09-01)']);
    expect((await db.query(`select count(*)::int n from contrato_versao where colaborador_id=$1 and vigencia @> '2026-08-31'::date`, [id])).rows[0].n).toBe(1);
    expect((await db.query(`select count(*)::int n from contrato_versao where colaborador_id=$1 and vigencia @> '2026-09-01'::date`, [id])).rows[0].n).toBe(0);
    await expect(q(adm, `select desligar_colaborador($1,'2026-09-30')`, [id])).rejects.toThrow(/já desligado/);
    await expect(alterar(adm, id, '2026-10-01')).rejects.toThrow(/desligado/);
  });
  it('desligar com contrato futuro ou antes da admissão é recusado', async () => {
    const id = await novoColab('2026-03-01');
    await expect(q(adm, `select desligar_colaborador($1,'2026-02-28')`, [id])).rejects.toThrow(/anterior à admissão/);
    await alterar(adm, id, '2026-10-01');
    await expect(q(adm, `select desligar_colaborador($1,'2026-09-01')`, [id])).rejects.toThrow(/começa depois/);
    await q(adm, `select desligar_colaborador($1,'2026-10-15')`, [id]);
    expect((await contratos(id)).at(-1)!.v).toBe('[2026-10-01,2026-10-16)');
  });
  it('remove o acesso ao aplicativo e avisa quantos dias ainda estão em escala', async () => {
    const id = await novoColab();
    const u = await novoUsuario(db, 'func');
    await db.query(`update colaborador set usuario_id=$2 where id=$1`, [id, u]);
    await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, u]);
    const esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Set','[2026-09-01,2026-10-01)',$2) returning id`, [emp, adm])).rows[0].id;
    for (const d of ['2026-09-01', '2026-09-02']) await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',480,1020,60)`, [esc, id, d]);
    await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo) values ($1,$2,'2026-09-03','folga')`, [esc, id]);
    const r = (await q<{ r: { dias_em_escala: number } }>(adm, `select desligar_colaborador($1,'2026-08-31') r`, [id]))[0]!.r;
    expect(r.dias_em_escala).toBe(2);
    expect((await db.query(`select usuario_id from colaborador where id=$1`, [id])).rows[0].usuario_id).toBeNull();
    expect((await db.query(`select count(*)::int n from membro where organizacao_id=$1 and usuario_id=$2`, [org, u])).rows[0].n).toBe(0);
  });
  it('reativar reabre o contrato e limpa a data; fica auditado', async () => {
    const id = await novoColab();
    await q(adm, `select desligar_colaborador($1,'2026-08-31')`, [id]);
    await expect(q(lider, `select reativar_colaborador($1)`, [id])).rejects.toThrow(/sem permissão/);
    await q(adm, `select reativar_colaborador($1)`, [id]);
    expect((await db.query(`select desligamento from colaborador where id=$1`, [id])).rows[0].desligamento).toBeNull();
    expect((await contratos(id)).map((x) => x.v)).toEqual(['[2026-01-05,)']);
    await expect(q(adm, `select reativar_colaborador($1)`, [id])).rejects.toThrow(/não está desligado/);
    const ac = (await db.query(`select acao from auditoria where tabela='colaborador' and registro_id=$1 and acao in ('desligamento','reativacao') order by id`, [id])).rows.map((r) => r.acao);
    expect(ac).toEqual(['desligamento', 'reativacao']);
  });
  it('só a gestão desliga', async () => {
    const id = await novoColab();
    await expect(q(lider, `select desligar_colaborador($1,'2026-08-31')`, [id])).rejects.toThrow(/sem permissão/);
    await expect(q(estranho, `select desligar_colaborador($1,'2026-08-31')`, [id])).rejects.toThrow(/sem permissão/);
  });
});
