import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { parseDaterange } from '../../rules-engine/src/datas';
import { REGRAS_SEED } from '../../rules-engine/src/fixtures/regras';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let admA: string, rhB: string, colab: string, lider: string, outroColab: string, superadm: string;
let orgA: string, orgB: string, empA: string, empB: string, setorA: string, c1: string, c2: string;
const PLAT = '00000000-0000-0000-0000-000000000001';

const novoColab = (uid: string, emp: string, nome: string, cpf: string, setor: string | null = null) =>
  comoUsuario(db, uid, async (c) => {
    const r = await c.query<{ id: string }>(
      `select inserir_colaborador($1,$2,$3,'2020-01-01',$4,null,null,null,'superior','11999990000') as id`, [emp, nome, cpf, setor]);
    return r.rows[0]!.id;
  });

beforeAll(async () => {
  db = await prepararBanco();
  admA = await novoUsuario(db, 'adma'); rhB = await novoUsuario(db, 'rhb');
  colab = await novoUsuario(db, 'colab'); lider = await novoUsuario(db, 'lider');
  outroColab = await novoUsuario(db, 'outro'); superadm = await novoUsuario(db, 'super');
  const org = (uid: string, n: string) => comoUsuario(db, uid, async (c) =>
    (await c.query<{ id: string }>(`select criar_organizacao($1,'empresa') id`, [n])).rows[0]!.id);
  orgA = await org(admA, 'A'); orgB = await org(rhB, 'B');
  const emp = (uid: string, o: string, cnpj: string) => comoUsuario(db, uid, async (c) =>
    (await c.query<{ id: string }>(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf)
      values ($1,'E',$2,'medio','3550308','SP') returning id`, [o, cnpj])).rows[0]!.id);
  empA = await emp(admA, orgA, '1'); empB = await emp(rhB, orgB, '2');
  await db.query(`insert into membro values ($1,$2,'colaborador'),($1,$3,'lider'),($1,$4,'colaborador')`, [orgA, colab, lider, outroColab]);
  await db.query(`insert into membro values ($1,$2,'superadmin')`, [PLAT, superadm]);
  const u = await comoUsuario(db, admA, async (c) => (await c.query<{ id: string }>(
    `insert into unidade (empresa_id, nome, municipio_ibge) values ($1,'Matriz','3550308') returning id`, [empA])).rows[0]!.id);
  setorA = await comoUsuario(db, admA, async (c) => (await c.query<{ id: string }>(
    `insert into setor (unidade_id, nome, lider_usuario_id) values ($1,'Loja',$2) returning id`, [u, lider])).rows[0]!.id);
  c1 = await novoColab(admA, empA, 'Maria', '111.444.777-35', setorA);
  c2 = await novoColab(admA, empA, 'João', '52998224725');
  await db.query(`update colaborador set usuario_id=$1 where id=$2`, [colab, c1]);
  await db.query(`update colaborador set usuario_id=$1 where id=$2`, [outroColab, c2]);
  await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala)
    values ($1,'[2020-01-01,)',25000,2640,220,'6x1'), ($2,'[2020-01-01,)',3000,2640,220,'6x1')`, [c1, c2]);
});
afterAll(async () => { await db.end(); });

describe('seeds', () => {
  it('traz as 8 regras e feriados 2026–2028', async () => {
    const r = await db.query(`select codigo from regra_jornada order by codigo`);
    expect(r.rows.map((x) => x.codigo)).toEqual(['EC141_ACORDO_COMP', 'EC141_ACORDO_DIARIA', 'EC141_ALTA_RENDA', 'EC141_F1', 'EC141_F2', 'EC141_PEQUENA_EMPRESA', 'EC141_TERC_PUBLICO', 'LEGADO_44H']);
    const f = await db.query(`select count(*)::int n from feriado where data between '2026-01-01' and '2028-12-31'`);
    expect(f.rows[0].n).toBe(30);
  });
  it('seed SQL é idêntica ao fixture usado nos testes do motor (sem divergência)', async () => {
    const { rows } = await db.query(`select codigo, vigencia::text v, escopo, parametros, prioridade, ativa from regra_jornada`);
    const doBanco = rows.map((r) => ({ codigo: r.codigo, vigencia: parseDaterange(r.v), escopo: r.escopo, parametros: r.parametros, prioridade: r.prioridade, ativa: r.ativa }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    const fixture = [...REGRAS_SEED].sort((a, b) => a.codigo.localeCompare(b.codigo));
    expect(doBanco).toEqual(fixture);
  });
  it('seed é idempotente', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const f of ['regras', 'feriados']) await db.query(readFileSync(join(import.meta.dirname, `../seeds/${f}.sql`), 'utf8'));
    expect((await db.query(`select count(*)::int n from regra_jornada`)).rows[0].n).toBe(8);
    expect((await db.query(`select count(*)::int n from feriado`)).rows[0].n).toBe(30);
  });
});

describe('regras legais', () => {
  it('qualquer autenticado lê; só superadmin escreve (sem deploy)', async () => {
    expect((await comoUsuario(db, admA, (c) => c.query('select 1 from regra_jornada'))).rowCount).toBe(8);
    await expect(comoUsuario(db, admA, (c) => c.query(`update regra_jornada set ativa=false`))).resolves.toMatchObject({ rowCount: 0 });
    await expect(comoUsuario(db, admA, (c) => c.query(`insert into regra_jornada (codigo,descricao,vigencia,parametros) values ('X','x','[2030-01-01,)','{}')`))).rejects.toThrow(/row-level security/);
    const up = await comoUsuario(db, superadm, (c) => c.query(`update regra_jornada set parametros = jsonb_set(parametros,'{salario_minimo}','22000') where codigo='EC141_ALTA_RENDA'`));
    expect(up.rowCount).toBe(1);
    const aud = await db.query(`select 1 from auditoria where organizacao_id=$1 and tabela='regra_jornada'`, [PLAT]);
    expect(aud.rowCount).toBeGreaterThan(0);
    await db.query(`update regra_jornada set parametros = jsonb_set(parametros,'{salario_minimo}','21188.87') where codigo='EC141_ALTA_RENDA'`);
  });
});

describe('isolamento de cadastros', () => {
  it('outra organização não vê colaboradores, contratos, setores', async () => {
    for (const t of ['colaborador', 'contrato_versao', 'setor', 'unidade', 'vw_colaborador_vigente']) {
      const r = await comoUsuario(db, rhB, (c) => c.query(`select 1 from ${t}`));
      expect(r.rowCount, t).toBe(0);
    }
  });
  it('não cria colaborador em empresa alheia', async () => {
    await expect(novoColab(rhB, empA, 'X', '39053344705')).rejects.toThrow(/sem permissão/);
  });
  it('organizacao_id é herdada da empresa (não dá para forjar)', async () => {
    const r = await comoUsuario(db, admA, (c) => c.query(`select organizacao_id from colaborador where id=$1`, [c1]));
    expect(r.rows[0].organizacao_id).toBe(orgA);
    await expect(comoUsuario(db, admA, (c) => c.query(
      `insert into diagnostico (organizacao_id, empresa_id, data_referencia, resumo) values ($1,$2,'2026-10-28','{}')`, [orgB, empA]))
    ).resolves.toBeDefined(); // gatilho sobrescreve com a org da empresa
    const d = await db.query(`select organizacao_id from diagnostico where empresa_id=$1`, [empA]);
    expect(d.rows.every((x) => x.organizacao_id === orgA)).toBe(true);
  });
});

describe('colaborador e líder não enxergam a empresa inteira', () => {
  it('colaborador vê só a si mesmo e o próprio contrato', async () => {
    const r = await comoUsuario(db, colab, (c) => c.query('select id from colaborador'), 'aal1');
    expect(r.rows.map((x) => x.id)).toEqual([c1]);
    const k = await comoUsuario(db, colab, (c) => c.query('select colaborador_id from contrato_versao'), 'aal1');
    expect(k.rows.map((x) => x.colaborador_id)).toEqual([c1]);
    expect((await comoUsuario(db, colab, (c) => c.query('select 1 from empresa'), 'aal1')).rowCount).toBe(1);
  });
  it('colaborador não altera nada', async () => {
    const u = await comoUsuario(db, colab, (c) => c.query(`update contrato_versao set salario_base = 99999`), 'aal1');
    expect(u.rowCount).toBe(0);
    await expect(novoColab(colab, empA, 'Y', '39053344705')).rejects.toThrow(/sem permissão/);
  });
  it('líder vê colaboradores do seu setor, sem salários', async () => {
    const r = await comoUsuario(db, lider, (c) => c.query('select id from colaborador'), 'aal1');
    expect(r.rows.map((x) => x.id)).toEqual([c1]);
    expect((await comoUsuario(db, lider, (c) => c.query('select 1 from contrato_versao'), 'aal1')).rowCount).toBe(0);
  });
});

describe('dados pessoais', () => {
  it('CPF e telefone ficam cifrados; hash por empresa impede duplicidade', async () => {
    const r = await db.query(`select cpf_cifrado, cpf_hash from colaborador where id=$1`, [c1]);
    expect(Buffer.from(r.rows[0].cpf_cifrado).toString('latin1')).not.toContain('11144477735');
    await expect(novoColab(admA, empA, 'Dup', '111.444.777-35')).rejects.toThrow(/duplicate|unique/);
    await expect(novoColab(admA, empA, 'Ruim', '123')).rejects.toThrow(/CPF inválido/);
  });
  it('revelar exige permissão e é auditado', async () => {
    const r = await comoUsuario(db, admA, (c) => c.query(`select * from revelar_dados_colaborador($1)`, [c1]));
    expect(r.rows[0]).toEqual({ cpf: '11144477735', telefone: '11999990000' });
    await expect(comoUsuario(db, colab, (c) => c.query(`select * from revelar_dados_colaborador($1)`, [c1]), 'aal1')).rejects.toThrow(/sem permissão/);
    expect((await db.query(`select 1 from auditoria where acao='revelar_pii' and organizacao_id=$1`, [orgA])).rowCount).toBe(1);
  });
  it('usuário não chama as funções de criptografia diretamente', async () => {
    await expect(comoUsuario(db, admA, (c) => c.query(`select hash_cpf('1')`))).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(db, admA, (c) => c.query(`select segredo('chave_dados')`))).rejects.toThrow(/permission denied/);
  });
});

describe('contrato e alta renda', () => {
  it('impede versões de contrato sobrepostas', async () => {
    await expect(db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala)
      values ($1,'[2025-01-01,)',1000,2640,220,'6x1')`, [c1])).rejects.toThrow(/exclusion|conflicting/);
  });
  it('view marca hipersuficiente por escolaridade + salário ≥ piso (limite exato)', async () => {
    const v = async () => (await comoUsuario(db, admA, (c) => c.query(`select colaborador_id, hipersuficiente from vw_colaborador_vigente`))).rows;
    let r = await v();
    expect(r.find((x) => x.colaborador_id === c1).hipersuficiente).toBe(true);   // superior, 25.000
    expect(r.find((x) => x.colaborador_id === c2).hipersuficiente).toBe(false);  // superior, 3.000
    await db.query(`update contrato_versao set salario_base = 21188.87 where colaborador_id=$1`, [c1]);
    r = await v(); expect(r.find((x) => x.colaborador_id === c1).hipersuficiente).toBe(true);
    await db.query(`update contrato_versao set salario_base = 21188.86 where colaborador_id=$1`, [c1]);
    r = await v(); expect(r.find((x) => x.colaborador_id === c1).hipersuficiente).toBe(false);
    await db.query(`update contrato_versao set salario_base = 25000 where colaborador_id=$1`, [c1]);
    await db.query(`update colaborador set escolaridade='medio' where id=$1`, [c1]);
    r = await v(); expect(r.find((x) => x.colaborador_id === c1).hipersuficiente).toBe(false);
  });
});

describe('acordos coletivos', () => {
  it('só advogado/admin da org cria; cláusulas seguem o acordo; RH do cliente enxerga os da sua empresa', async () => {
    const ac = await comoUsuario(db, admA, async (c) => (await c.query<{ id: string }>(
      `insert into acordo_coletivo (organizacao_id, empresa_id, tipo, vigencia, status) values ($1,$2,'acordo','[2026-01-01,2027-01-01)','vigente') returning id`, [orgA, empA])).rows[0]!.id);
    await comoUsuario(db, admA, (c) => c.query(`insert into clausula_jornada (acordo_id, tipo, parametros) values ($1,'regime_compensatorio','{"escala":"12x36"}')`, [ac]));
    expect((await comoUsuario(db, rhB, (c) => c.query('select 1 from acordo_coletivo'))).rowCount).toBe(0);
    expect((await comoUsuario(db, rhB, (c) => c.query('select 1 from clausula_jornada'))).rowCount).toBe(0);
    await expect(comoUsuario(db, rhB, (c) => c.query(`insert into clausula_jornada (acordo_id, tipo, parametros) values ($1,'banco_horas','{}')`, [ac]))).rejects.toThrow(/row-level security/);
    expect((await comoUsuario(db, colab, (c) => c.query('select 1 from acordo_coletivo'), 'aal1')).rowCount).toBe(0);
  });
});
