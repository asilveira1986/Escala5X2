import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let adm: string, outroAdm: string, lider: string;
let org: string, emp: string, c1: string, c2: string, c3: string;
const convidar = (uid: string, colab: string, email: string) =>
  comoUsuario(db, uid, async (c) => (await c.query<{ r: { estado: string } }>(`select convidar_colaborador($1,$2) r`, [colab, email])).rows[0]!.r);
/** Simula o Supabase Auth: cadastro por link mágico (sem confirmação) e depois o clique no link. */
async function cadastrar(email: string, confirmado: boolean) {
  return (await db.query<{ id: string }>(`insert into auth.users (email, email_confirmed_at) values ($1, ${confirmado ? 'now()' : 'null'}) returning id`, [email])).rows[0]!.id;
}
const dono = async (colab: string) => (await db.query(`select usuario_id from colaborador where id=$1`, [colab])).rows[0].usuario_id as string | null;
const papeis = async (uid: string) => (await db.query(`select papel from membro where organizacao_id=$1 and usuario_id=$2`, [org, uid])).rows.map((r) => r.papel);

beforeAll(async () => {
  db = await prepararBanco();
  adm = await novoUsuario(db, 'adm'); outroAdm = await novoUsuario(db, 'outro'); lider = await novoUsuario(db, 'lider');
  org = await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, outroAdm, (c) => c.query(`select criar_organizacao('B','empresa')`));
  await db.query(`insert into membro values ($1,$2,'lider')`, [org, lider]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01') returning id`, [emp, n, cpf])).rows[0].id as string;
  c1 = await mk('Ana', '1'); c2 = await mk('Bia', '2'); c3 = await mk('Caio', '3');
});
afterAll(async () => { await db.end(); });

describe('convite do colaborador', () => {
  it('convite pendente: não liga ninguém até o e-mail ser confirmado; depois do clique no link, vincula e dá o papel', async () => {
    expect((await convidar(adm, c1, '  Ana@Empresa.com ')).estado).toBe('pendente');
    const conv = (await db.query(`select email, aceito_em from convite_colaborador where colaborador_id=$1`, [c1])).rows;
    expect(conv).toEqual([{ email: 'ana@empresa.com', aceito_em: null }]);
    const uid = await cadastrar('ana@empresa.com', false); // pediu o link, ainda não clicou
    expect(await dono(c1)).toBeNull();
    await db.query(`update auth.users set email_confirmed_at = now() where id=$1`, [uid]); // clicou
    expect(await dono(c1)).toBe(uid);
    expect(await papeis(uid)).toEqual(['colaborador']);
    expect((await db.query(`select aceito_em from convite_colaborador where colaborador_id=$1`, [c1])).rows[0].aceito_em).not.toBeNull();
    const visivel = await comoUsuario(db, uid, (c) => c.query(`select id from colaborador where usuario_id = auth.uid()`));
    expect(visivel.rows).toEqual([{ id: c1 }]);
  });
  it('cadastro com e-mail já confirmado (Google) vincula na hora do cadastro', async () => {
    await convidar(adm, c2, 'bia@empresa.com');
    const uid = await cadastrar('bia@empresa.com', true);
    expect(await dono(c2)).toBe(uid);
  });
  it('quem já tem conta confirmada é vinculado imediatamente', async () => {
    const uid = await cadastrar('caio@empresa.com', true);
    expect((await convidar(adm, c3, 'caio@empresa.com')).estado).toBe('vinculado');
    expect(await dono(c3)).toBe(uid);
    expect(await papeis(uid)).toEqual(['colaborador']);
  });
  it('não vincula por e-mail digitado sem confirmação, de outro e-mail, ou com convite vencido', async () => {
    const c = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Dani',cifrar_texto('4'),hash_cpf('4'),'2020-01-01') returning id`, [emp])).rows[0].id;
    await convidar(adm, c, 'dani@empresa.com');
    const impostor = await cadastrar('dani.outro@gmail.com', true);
    expect(await dono(c)).toBeNull();
    expect(await papeis(impostor)).toEqual([]);
    await db.query(`update convite_colaborador set expira_em = now() - interval '1 day' where colaborador_id=$1`, [c]);
    await cadastrar('dani@empresa.com', true);
    expect(await dono(c)).toBeNull(); // convite vencido
  });
  it('só gestão convida: líder, colaborador e outra organização recebem "sem permissão"', async () => {
    const livre = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Edu',cifrar_texto('5'),hash_cpf('5'),'2020-01-01') returning id`, [emp])).rows[0].id;
    await expect(convidar(lider, livre, 'edu@empresa.com')).rejects.toThrow(/sem permissão/);
    await expect(convidar(outroAdm, livre, 'edu@empresa.com')).rejects.toThrow(/sem permissão/);
    expect((await db.query(`select count(*)::int n from convite_colaborador where colaborador_id=$1`, [livre])).rows[0].n).toBe(0);
  });
  it('validações: e-mail inválido, colaborador que já tem acesso, e-mail repetido na empresa', async () => {
    await expect(convidar(adm, c1, 'x@empresa.com')).rejects.toThrow(/já tem acesso/);
    const livre = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Fabi',cifrar_texto('6'),hash_cpf('6'),'2020-01-01') returning id`, [emp])).rows[0].id;
    await expect(convidar(adm, livre, 'sem-arroba')).rejects.toThrow(/e-mail válido/);
    await convidar(adm, livre, 'fabi@empresa.com');
    const outro = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Gil',cifrar_texto('7'),hash_cpf('7'),'2020-01-01') returning id`, [emp])).rows[0].id;
    await expect(convidar(adm, outro, 'fabi@empresa.com')).rejects.toThrow(/outro colaborador/);
    await expect(convidar(adm, outro, 'ana@empresa.com')).rejects.toThrow(/outro colaborador/); // conta de Ana já ligada a c1
  });
  it('reenviar substitui o convite pendente (um só por colaborador)', async () => {
    const c = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Hugo',cifrar_texto('8'),hash_cpf('8'),'2020-01-01') returning id`, [emp])).rows[0].id;
    await convidar(adm, c, 'errado@empresa.com'); await convidar(adm, c, 'hugo@empresa.com');
    expect((await db.query(`select email from convite_colaborador where colaborador_id=$1 and aceito_em is null`, [c])).rows).toEqual([{ email: 'hugo@empresa.com' }]);
  });
  it('convites não são gravados nem lidos direto pelo cliente; só gestão lê', async () => {
    await expect(comoUsuario(db, adm, (c) => c.query(`insert into convite_colaborador (organizacao_id, colaborador_id, email) values ($1,$2,'a@b.co')`, [org, c1]))).rejects.toThrow();
    expect((await comoUsuario(db, adm, (c) => c.query(`select 1 from convite_colaborador`))).rowCount).toBeGreaterThan(0);
    expect((await comoUsuario(db, lider, (c) => c.query(`select 1 from convite_colaborador`))).rowCount).toBe(0);
    expect((await comoUsuario(db, outroAdm, (c) => c.query(`select 1 from convite_colaborador`))).rowCount).toBe(0);
  });
  it('revogar acesso desliga o usuário, tira o papel e cancela convites; é auditado', async () => {
    const uid = (await dono(c1))!;
    await comoUsuario(db, adm, (c) => c.query(`select revogar_acesso_colaborador($1)`, [c1]));
    expect(await dono(c1)).toBeNull();
    expect(await papeis(uid)).toEqual([]);
    await expect(comoUsuario(db, lider, (c) => c.query(`select revogar_acesso_colaborador($1)`, [c2]))).rejects.toThrow(/sem permissão/);
    expect(await dono(c2)).not.toBeNull();
    const acoes = (await db.query(`select distinct acao from auditoria where organizacao_id=$1 and registro_id = $2::text`, [org, c1])).rows.map((r) => r.acao);
    expect(acoes).toEqual(expect.arrayContaining(['convite_enviado', 'acesso_revogado']));
  });
  it('quem tem papel de gestão não é rebaixado ao ser vinculado como colaborador', async () => {
    const c = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Iara',cifrar_texto('9'),hash_cpf('9'),'2020-01-01') returning id`, [emp])).rows[0].id;
    const uid = await cadastrar('iara@empresa.com', true);
    await db.query(`insert into membro values ($1,$2,'rh')`, [org, uid]);
    await convidar(adm, c, 'iara@empresa.com');
    expect(await dono(c)).toBe(uid);
    expect(await papeis(uid)).toEqual(['rh']);
    await comoUsuario(db, adm, (cl) => cl.query(`select revogar_acesso_colaborador($1)`, [c]));
    expect(await papeis(uid)).toEqual(['rh']); // revogar não remove papel de gestão
  });
});
