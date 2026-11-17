import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client; let adm: string, estranho: string, lider: string; let org: string, emp: string;
const CPF = '52998224725'; // válido
const cadastrar = (uid: string, over: Record<string, unknown> = {}) => comoUsuario(db, uid, async (c) => {
  const a = { empresa: emp, nome: '  Ana Souza ', cpf: CPF, adm: '2026-03-02', sal: 2500.5, jor: 2640, div: 220, tipo: '5x2', setor: 'Padaria', ...over };
  return (await c.query<{ id: string }>(
    `select cadastrar_colaborador($1,$2,$3,$4::date,$5::numeric,$6::int,$7::int,$8,$9,'M-1','Padeira','514105','medio','11999990000','Manhã',null::smallint,120) id`,
    [a.empresa, a.nome, a.cpf, a.adm, a.sal, a.jor, a.div, a.tipo, a.setor])).rows[0]!.id;
});

beforeAll(async () => {
  db = await prepararBanco();
  adm = await novoUsuario(db, 'adm'); estranho = await novoUsuario(db, 'estranho'); lider = await novoUsuario(db, 'lider');
  org = await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, estranho, (c) => c.query(`select criar_organizacao('B','empresa')`));
  await db.query(`insert into membro values ($1,$2,'lider')`, [org, lider]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
});
afterAll(async () => { await db.end(); });

describe('cadastrar_colaborador', () => {
  it('cria a pessoa, o setor (e a unidade Matriz) e o contrato vigente desde a admissão', async () => {
    const id = await cadastrar(adm);
    const c = (await db.query(`select nome, matricula, cargo, cbo, escolaridade, setor_id, decifrar_texto(cpf_cifrado) cpf, decifrar_texto(telefone_cifrado) tel from colaborador where id=$1`, [id])).rows[0];
    expect(c).toMatchObject({ nome: 'Ana Souza', matricula: 'M-1', cargo: 'Padeira', cbo: '514105', escolaridade: 'medio', cpf: CPF, tel: '11999990000' });
    expect((await db.query(`select s.nome sn, u.nome un from setor s join unidade u on u.id=s.unidade_id where s.id=$1`, [c.setor_id])).rows[0]).toEqual({ sn: 'Padaria', un: 'Matriz' });
    const k = (await db.query(`select vigencia::text v, salario_base::text s, jornada_semanal_min j, divisor d, tipo_escala t, turno, horas_extras_mensais_min he from contrato_versao where colaborador_id=$1`, [id])).rows;
    expect(k).toEqual([{ v: '[2026-03-02,)', s: '2500.50', j: 2640, d: 220, t: '5x2', turno: 'Manhã', he: 120 }]);
    // aparece na visão usada pela tela e pelo diagnóstico
    expect((await db.query(`select count(*)::int n from vw_colaborador_vigente where colaborador_id=$1`, [id])).rows[0].n).toBe(1);
  });

  it('reaproveita o setor existente (sem diferenciar maiúsculas) e não duplica a unidade', async () => {
    await cadastrar(adm, { cpf: '11144477735', setor: 'padaria' });
    expect((await db.query(`select count(*)::int n from setor s join unidade u on u.id=s.unidade_id where u.empresa_id=$1`, [emp])).rows[0].n).toBe(1);
    expect((await db.query(`select count(*)::int n from unidade where empresa_id=$1`, [emp])).rows[0].n).toBe(1);
  });

  it('recusa CPF repetido, CPF inválido e salário zero, sem deixar lixo para trás', async () => {
    const antes = (await db.query(`select count(*)::int n from colaborador where empresa_id=$1`, [emp])).rows[0].n;
    await expect(cadastrar(adm)).rejects.toThrow(/CPF já cadastrado/);
    await expect(cadastrar(adm, { cpf: '123' })).rejects.toThrow(/CPF inválido/);
    await expect(cadastrar(adm, { cpf: '39053344705', sal: 0 })).rejects.toThrow();
    expect((await db.query(`select count(*)::int n from colaborador where empresa_id=$1`, [emp])).rows[0].n).toBe(antes);
  });

  it('só quem gere a empresa cadastra: líder e pessoa de fora são recusados', async () => {
    await expect(cadastrar(lider, { cpf: '39053344705' })).rejects.toThrow(/sem permissão/);
    await expect(cadastrar(estranho, { cpf: '39053344705' })).rejects.toThrow(/sem permissão/);
  });

  it('fica na trilha de auditoria (colaborador e contrato)', async () => {
    const id = await cadastrar(adm, { cpf: '39053344705' });
    const t = (await db.query(`select distinct tabela from auditoria where registro_id = $1 or registro_id in (select id::text from contrato_versao where colaborador_id=$2)`, [id, id])).rows.map((r) => r.tabela).sort();
    expect(t).toEqual(['colaborador', 'contrato_versao']);
  });
});
