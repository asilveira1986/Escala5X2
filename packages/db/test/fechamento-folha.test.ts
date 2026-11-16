import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let rh: string, ua: string, uOrgB: string, contador: string, orgContab: string;
let org: string, emp: string, A: string, hoje: string;
const mesPassado = () => { const d = new Date(`${hoje}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
const dados = (n = 1) => ({ competencia: '2027-01', linhas: Array.from({ length: n }, (_, i) => ({ colaboradorId: A, nome: `Pessoa ${i}`, trabalhadasMin: 9600 })), avisos: [] });
const fechar = (uid: string, comp: string, d: unknown = dados(), motivo: string | null = null) =>
  comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(`select fechar_folha($1,$2,$3::jsonb,$4) id`, [emp, comp, JSON.stringify(d), motivo])).rows[0]!.id);

beforeAll(async () => {
  db = await prepararBanco();
  hoje = (await db.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
  rh = await novoUsuario(db, 'rh'); ua = await novoUsuario(db, 'ua'); uOrgB = await novoUsuario(db, 'orgb'); contador = await novoUsuario(db, 'contador');
  const org_ = (u: string, n: string, t = 'empresa') => comoUsuario(db, u, async (c) => (await c.query<{ id: string }>(`select criar_organizacao($1,$2::tipo_org) id`, [n, t])).rows[0]!.id);
  org = await org_(rh, 'A'); await org_(uOrgB, 'B'); orgContab = await org_(contador, 'Contab', 'contabilidade');
  await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, ua]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  A = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id, matricula, cargo) values ($1,'Ana',cifrar_texto('1'),hash_cpf('1'),'2020-01-01',$2,'M001','Caixa') returning id`, [emp, ua])).rows[0].id;
  await db.query(`insert into vinculo_empresa values ($1,$2,'gestao')`, [emp, orgContab]);
});
afterAll(async () => { await db.end(); });

describe('fechar_folha', () => {
  it('só fecha mês encerrado; o mês corrente e o futuro são recusados', async () => {
    const atual = (await db.query(`select date_trunc('month', hoje_sp())::date::text d`)).rows[0].d as string;
    await expect(fechar(rh, atual)).rejects.toThrow(/mês já encerrado/);
    await expect(fechar(rh, '2099-01-01')).rejects.toThrow(/mês já encerrado/);
  });
  it('fecha: grava versão 1, hash do conteúdo, autor e auditoria; a competência é normalizada para o dia 1', async () => {
    const id = await fechar(rh, mesPassado().slice(0, 8) + '17');                                    // qualquer dia do mês vale
    const r = (await db.query(`select competencia::text c, versao, status, dados_hash, criado_por, motivo from fechamento_folha where id=$1`, [id])).rows[0];
    expect(r).toMatchObject({ c: mesPassado(), versao: 1, status: 'fechado', criado_por: rh, motivo: null });
    expect(r.dados_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await db.query(`select 1 from auditoria where tabela='fechamento_folha' and registro_id=$1 and acao='fechar'`, [id])).rowCount).toBe(1);
    expect((await comoUsuario(db, rh, (c) => c.query(`select fechamento_integro($1) ok`, [id]))).rows[0].ok).toBe(true);
  });
  it('reabrir exige motivo; a versão anterior fica substituída e continua guardada; só uma vigente por mês', async () => {
    const comp = mesPassado();
    await expect(fechar(rh, comp, dados(2))).rejects.toThrow(/motivo da reabertura/);
    await expect(fechar(rh, comp, dados(2), 'abc')).rejects.toThrow(/motivo da reabertura/);
    const v2 = await fechar(rh, comp, dados(2), 'Correção de uma falta lançada');
    const vs = (await db.query(`select versao, status, motivo from fechamento_folha where empresa_id=$1 and competencia=$2 order by versao`, [emp, comp])).rows;
    expect(vs).toEqual([{ versao: 1, status: 'substituido', motivo: null }, { versao: 2, status: 'fechado', motivo: 'Correção de uma falta lançada' }]);
    expect((await db.query(`select id from fechamento_folha where empresa_id=$1 and competencia=$2 and status='fechado'`, [emp, comp])).rows[0].id).toBe(v2);
  });
  it('recusa fechamento sem linhas ou com conteúdo inválido', async () => {
    const outro = '2020-03-01';
    await expect(fechar(rh, outro, { linhas: [] })).rejects.toThrow(/nenhuma linha/);
    await expect(fechar(rh, outro, { x: 1 })).rejects.toThrow(/nenhuma linha/);
    await expect(fechar(rh, outro, [1, 2])).rejects.toThrow(/nenhuma linha/);
  });
  it('quem não gere a empresa não fecha: colaborador, outra organização', async () => {
    await expect(fechar(ua, '2020-04-01')).rejects.toThrow(/sem permissão/);
    await expect(fechar(uOrgB, '2020-04-01')).rejects.toThrow(/sem permissão/);
  });
  it('o contador vinculado com gestão fecha; o comando é auditado em nome dele', async () => {
    const id = await fechar(contador, '2020-05-01');
    expect((await db.query(`select criado_por from fechamento_folha where id=$1`, [id])).rows[0].criado_por).toBe(contador);
  });
});

describe('imutabilidade e leitura', () => {
  it('ninguém edita, troca o status direto ou apaga, nem o dono do banco', async () => {
    const id = (await db.query(`select id from fechamento_folha where status='fechado' limit 1`)).rows[0].id;
    await expect(db.query(`update fechamento_folha set dados = '{"linhas":[1]}' where id=$1`, [id])).rejects.toThrow(/imutável/);
    await expect(db.query(`update fechamento_folha set status='substituido' where id=$1`, [id])).rejects.toThrow(/imutável/);     // sem a função de fechar
    await expect(db.query(`delete from fechamento_folha where id=$1`, [id])).rejects.toThrow(/não pode ser apagado/);
    await expect(comoUsuario(db, rh, (c) => c.query(`update fechamento_folha set dados='{}'`))).rejects.toThrow();
    await expect(comoUsuario(db, rh, (c) => c.query(`insert into fechamento_folha (organizacao_id, empresa_id, competencia, versao, dados, dados_hash) values ($1,$2,'2020-06-01',1,'{}','x')`, [org, emp]))).rejects.toThrow();
  });
  it('a conferência de integridade pega adulteração feita por fora', async () => {
    const id = (await db.query(`select id from fechamento_folha where status='fechado' limit 1`)).rows[0].id;
    await db.query(`alter table fechamento_folha disable trigger proteger`);
    const antes = (await db.query(`select dados::text d from fechamento_folha where id=$1`, [id])).rows[0].d;
    const r = await db.query(`update fechamento_folha set dados = jsonb_set(dados, '{linhas,0,trabalhadasMin}', '1') where id=$1`, [id]);
    await db.query(`alter table fechamento_folha enable trigger proteger`);
    expect(r.rowCount).toBe(1);
    expect((await db.query(`select dados::text d from fechamento_folha where id=$1`, [id])).rows[0].d).not.toBe(antes);
    expect((await comoUsuario(db, rh, (c) => c.query(`select fechamento_integro($1) ok`, [id]))).rows[0].ok).toBe(false);
  });
  it('RH e contador leem; colaborador e outra organização não', async () => {
    const ver = async (u: string) => (await comoUsuario(db, u, (c) => c.query(`select 1 from fechamento_folha`))).rowCount;
    expect(await ver(rh)).toBeGreaterThan(0); expect(await ver(contador)).toBeGreaterThan(0);
    expect(await ver(ua)).toBe(0); expect(await ver(uOrgB)).toBe(0);
  });
});

describe('fechamento_entrada e exportação', () => {
  it('traz colaboradores com matrícula e cargo, escalas publicadas do mês, ausências e o banco de horas', async () => {
    await db.query(`insert into ausencia (empresa_id, colaborador_id, periodo, tipo) values ($1,$2,'[2027-02-03,2027-02-06)','ferias')`, [emp, A]);
    const r = (await comoUsuario(db, rh, (c) => c.query(`select fechamento_entrada($1,'2027-02-15') j`, [emp]))).rows[0].j;
    expect(r).toMatchObject({ inicio: '2027-02-01', fim: '2027-02-28', escalas: [], versao_vigente: null });
    expect(r.colaboradores).toEqual([expect.objectContaining({ id: A, nome: 'Ana', matricula: 'M001', cargo: 'Caixa' })]);
    expect(r.ausencias).toEqual([{ colaboradorId: A, inicio: '2027-02-03', fim: '2027-02-05', tipo: 'ferias' }]);
    expect(r.banco).toEqual([]);
  });
  it('quem não pode acessar a empresa não recebe a entrada', async () => {
    await expect(comoUsuario(db, ua, (c) => c.query(`select fechamento_entrada($1,'2027-02-01')`, [emp]))).rejects.toThrow(/sem permissão/);
    await expect(comoUsuario(db, uOrgB, (c) => c.query(`select fechamento_entrada($1,'2027-02-01')`, [emp]))).rejects.toThrow(/sem permissão/);
  });
  it('exportação é auditada com layout e formato; só quem gere; valores inválidos são recusados', async () => {
    const id = (await db.query(`select id from fechamento_folha where status='fechado' limit 1`)).rows[0].id;
    await comoUsuario(db, rh, (c) => c.query(`select registrar_exportacao_folha($1,'csv','generico')`, [id]));
    expect((await db.query(`select 1 from auditoria where tabela='fechamento_folha' and registro_id=$1 and acao='exportar:generico:csv'`, [id])).rowCount).toBe(1);
    await expect(comoUsuario(db, ua, (c) => c.query(`select registrar_exportacao_folha($1,'csv','generico')`, [id]))).rejects.toThrow(/sem permissão/);
    await expect(comoUsuario(db, rh, (c) => c.query(`select registrar_exportacao_folha($1,'pdf','generico')`, [id]))).rejects.toThrow(/inválido/);
    await expect(comoUsuario(db, rh, (c) => c.query(`select registrar_exportacao_folha($1,'csv','Layout Estranho!')`, [id]))).rejects.toThrow(/inválido/);
  });
});
