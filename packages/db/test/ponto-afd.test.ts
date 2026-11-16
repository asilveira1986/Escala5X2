import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let rh: string, ua: string, uOrgB: string;
let org: string, emp: string, A: string, B: string;
const HASH = 'a'.repeat(64);
const CPF_A = '52998224725', PIS_B = '12345678919';
const marcas = (...itens: Array<[string, string, string, number?]>) => itens.map(([momento, tipo, identificador, nsr], i) => ({ momento, tipo, identificador, nsr: nsr ?? i + 1 }));
const iniciar = (uid: string, hash = HASH, nome = 'afd.txt', empresa = emp) =>
  comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(`select iniciar_importacao_afd($1,$2,$3,'portaria_671') id`, [empresa, nome, hash])).rows[0]!.id);
const importar = (uid: string, imp: string, lista: unknown) => comoUsuario(db, uid, async (c) => (await c.query<{ r: Record<string, number> }>(`select importar_marcacoes_afd($1,$2::jsonb) r`, [imp, JSON.stringify(lista)])).rows[0]!.r);
const donos = async () => (await db.query(`select tipo_identificador t, colaborador_id c, count(*)::int n from marcacao_ponto group by 1,2 order by 1`)).rows;

beforeAll(async () => {
  db = await prepararBanco();
  rh = await novoUsuario(db, 'rh'); ua = await novoUsuario(db, 'ua'); uOrgB = await novoUsuario(db, 'orgb');
  org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, uOrgB, (c) => c.query(`select criar_organizacao('B','empresa')`));
  await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, ua]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string, u: string | null) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4) returning id`, [emp, n, cpf, u])).rows[0].id as string;
  A = await mk('Ana', CPF_A, ua); B = await mk('Bia', '11144477735', null);
});
afterAll(async () => { await db.end(); });

describe('importação do AFD', () => {
  it('CPF reconhecido pelo cadastro: marcações entram já vinculadas; sem CPF/PIS em claro no banco', async () => {
    const imp = await iniciar(rh);
    const r = await importar(rh, imp, marcas(['2027-02-01T11:00:00Z', 'cpf', CPF_A], ['2027-02-01T15:00:00Z', 'cpf', CPF_A], ['2027-02-01T11:00:00Z', 'pis', PIS_B]));
    expect(r).toEqual({ recebidas: 3, inseridas: 3, jaExistiam: 0 });
    expect(await donos()).toEqual([{ t: 'cpf', c: A, n: 2 }, { t: 'pis', c: null, n: 1 }]);
    const linha = (await db.query(`select to_jsonb(m)::text j, identificador_final f from marcacao_ponto m limit 1`)).rows[0];
    expect(linha.j).not.toContain(CPF_A);                                                  // só hash e 4 últimos dígitos
    expect(linha.f).toMatch(/^\d{4}$/);
    await comoUsuario(db, rh, (c) => c.query(`select finalizar_importacao_afd($1,'concluida',$2::jsonb)`, [imp, JSON.stringify({ marcacoes: 3 })]));
    expect((await db.query(`select status, relatorio->>'marcacoes' m from afd_importacao where id=$1`, [imp])).rows[0]).toEqual({ status: 'concluida', m: '3' });
  });
  it('o mesmo arquivo não entra duas vezes; marcação repetida em outro arquivo é ignorada', async () => {
    await expect(iniciar(rh)).rejects.toThrow(/mesmo arquivo já foi importado em \d\d\/\d\d\/\d{4}/);
    const imp = await iniciar(rh, 'b'.repeat(64), 'afd2.txt');
    const r = await importar(rh, imp, marcas(['2027-02-01T11:00:00Z', 'cpf', CPF_A], ['2027-02-02T11:00:00Z', 'cpf', CPF_A]));
    expect(r).toEqual({ recebidas: 2, inseridas: 1, jaExistiam: 1 });
    await comoUsuario(db, rh, (c) => c.query(`select finalizar_importacao_afd($1,'concluida','{}')`, [imp]));
  });
  it('PIS não reconhecido fica pendente com os 4 últimos dígitos; o RH mapeia uma vez e as marcações (e as próximas) já são do colaborador', async () => {
    const pend = (await comoUsuario(db, rh, (c) => c.query(`select * from identificadores_pendentes($1)`, [emp]))).rows;
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ tipo: 'pis', final4: PIS_B.slice(-4), marcacoes: '1' });
    const n = (await comoUsuario(db, rh, (c) => c.query(`select mapear_identificador_ponto($1,'pis',$2,$3) n`, [emp, pend[0].identificador_hash, B]))).rows[0].n;
    expect(n).toBe(1);
    expect((await comoUsuario(db, rh, (c) => c.query(`select * from identificadores_pendentes($1)`, [emp]))).rowCount).toBe(0);
    const imp = await iniciar(rh, 'c'.repeat(64), 'afd3.txt');
    await importar(rh, imp, marcas(['2027-02-03T11:00:00Z', 'pis', PIS_B]));                // nova importação já reconhece o PIS
    expect((await db.query(`select colaborador_id from marcacao_ponto where tipo_identificador='pis' order by momento desc limit 1`)).rows[0].colaborador_id).toBe(B);
    await comoUsuario(db, rh, (c) => c.query(`select finalizar_importacao_afd($1,'concluida','{}')`, [imp]));
  });
  it('CPF cadastrado depois também passa a ser reconhecido na próxima importação', async () => {
    const CPF_N = '39053344705';
    const imp = await iniciar(rh, 'd'.repeat(64), 'afd4.txt');
    await importar(rh, imp, marcas(['2027-02-04T11:00:00Z', 'cpf', CPF_N]));
    expect((await db.query(`select colaborador_id from marcacao_ponto where momento='2027-02-04T11:00:00Z'`)).rows[0].colaborador_id).toBeNull();
    const novo = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Nova',cifrar_texto($2),hash_cpf($2),'2020-01-01') returning id`, [emp, CPF_N])).rows[0].id;
    const imp2 = await iniciar(rh, 'e'.repeat(64), 'afd5.txt');
    await importar(rh, imp2, marcas(['2027-02-05T11:00:00Z', 'cpf', '11144477735']));          // qualquer importação revincula o que sobrou
    expect((await db.query(`select colaborador_id from marcacao_ponto where momento='2027-02-04T11:00:00Z'`)).rows[0].colaborador_id).toBe(novo);
    for (const i of [imp, imp2]) await comoUsuario(db, rh, (c) => c.query(`select finalizar_importacao_afd($1,'concluida','{}')`, [i]));
  });
});

describe('validações e permissões', () => {
  it('descarta o que não tem 11 dígitos ou tipo desconhecido; limita o lote; importação encerrada não aceita mais', async () => {
    const imp = await iniciar(rh, 'f'.repeat(64), 'afd6.txt');
    expect(await importar(rh, imp, marcas(['2027-03-01T11:00:00Z', 'cpf', '123'], ['2027-03-01T11:00:00Z', 'xyz', CPF_A], ['2027-03-01T11:00:00Z', 'cpf', CPF_A]))).toEqual({ recebidas: 3, inseridas: 1, jaExistiam: 2 });
    await expect(importar(rh, imp, Array.from({ length: 5001 }, () => ({})))).rejects.toThrow(/no máximo 5000/);
    await expect(importar(rh, imp, { a: 1 })).rejects.toThrow(/marcações inválidas/);
    await comoUsuario(db, rh, (c) => c.query(`select finalizar_importacao_afd($1,'concluida','{}')`, [imp]));
    await expect(importar(rh, imp, marcas(['2027-03-02T11:00:00Z', 'cpf', CPF_A]))).rejects.toThrow(/já foi encerrada/);
    await expect(comoUsuario(db, rh, (c) => c.query(`select finalizar_importacao_afd($1,'concluida','{}')`, [imp]))).rejects.toThrow(/Estado inválido/);
  });
  it('só quem gere a empresa importa, mapeia e desfaz: colaborador e outra organização, não', async () => {
    await expect(iniciar(ua, 'g'.repeat(64))).rejects.toThrow(/sem permissão/);
    await expect(iniciar(uOrgB, 'g'.repeat(64))).rejects.toThrow(/sem permissão/);
    const imp = (await db.query(`select id from afd_importacao limit 1`)).rows[0].id;
    await expect(importar(ua, imp, marcas(['2027-03-02T11:00:00Z', 'cpf', CPF_A]))).rejects.toThrow(/sem permissão/);
    await expect(comoUsuario(db, ua, (c) => c.query(`select desfazer_importacao_afd($1,'quero apagar')`, [imp]))).rejects.toThrow(/sem permissão/);
    await expect(comoUsuario(db, uOrgB, (c) => c.query(`select * from identificadores_pendentes($1)`, [emp]))).resolves.toBeDefined();
    expect((await comoUsuario(db, uOrgB, (c) => c.query(`select * from identificadores_pendentes($1)`, [emp]))).rowCount).toBe(0);   // outra organização não enxerga nada
  });
  it('mapear: colaborador de outra empresa, identificador desconhecido e hash inválido são recusados', async () => {
    const hashReal = (await db.query(`select identificador_hash h from marcacao_ponto limit 1`)).rows[0].h;
    const outraEmp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'Outra','2','medio','3550308','SP') returning id`, [org])).rows[0].id;
    const estranho = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'X',cifrar_texto('9'),hash_cpf('9'),'2020-01-01') returning id`, [outraEmp])).rows[0].id;
    await expect(comoUsuario(db, rh, (c) => c.query(`select mapear_identificador_ponto($1,'pis',$2,$3)`, [emp, hashReal, estranho]))).rejects.toThrow(/não pertence a esta empresa/);
    await expect(comoUsuario(db, rh, (c) => c.query(`select mapear_identificador_ponto($1,'pis',$2,$3)`, [emp, 'f'.repeat(64), A]))).rejects.toThrow(/desconhecido/);
    await expect(comoUsuario(db, rh, (c) => c.query(`select mapear_identificador_ponto($1,'pis','curto',$2)`, [emp, A]))).rejects.toThrow(/inválido/);
    await expect(comoUsuario(db, uOrgB, (c) => c.query(`select mapear_identificador_ponto($1,'pis',$2,$3)`, [emp, hashReal, A]))).rejects.toThrow(/sem permissão/);
  });
});

describe('imutabilidade, desfazer e leitura', () => {
  it('ninguém edita ou apaga marcação diretamente, nem o dono do banco', async () => {
    await expect(db.query(`update marcacao_ponto set momento = now()`)).rejects.toThrow(/imutável/);
    await expect(db.query(`update marcacao_ponto set colaborador_id = $1`, [A])).rejects.toThrow(/imutável/);
    await expect(db.query(`delete from marcacao_ponto`)).rejects.toThrow(/desfaça a importação inteira/);
    await expect(comoUsuario(db, rh, (c) => c.query(`delete from marcacao_ponto`))).rejects.toThrow();
  });
  it('desfazer a importação remove só as marcações dela, exige motivo e fica auditado; o arquivo pode ser reimportado', async () => {
    const imp = await iniciar(rh, '1'.repeat(64), 'errado.txt');
    await importar(rh, imp, marcas(['2027-04-01T11:00:00Z', 'cpf', CPF_A], ['2027-04-02T11:00:00Z', 'cpf', CPF_A]));
    await comoUsuario(db, rh, (c) => c.query(`select finalizar_importacao_afd($1,'concluida','{}')`, [imp]));
    const antes = (await db.query(`select count(*)::int n from marcacao_ponto`)).rows[0].n;
    await expect(comoUsuario(db, rh, (c) => c.query(`select desfazer_importacao_afd($1,'abc')`, [imp]))).rejects.toThrow(/motivo/);
    const n = (await comoUsuario(db, rh, (c) => c.query(`select desfazer_importacao_afd($1,'Arquivo de outra empresa') n`, [imp]))).rows[0].n;
    expect(n).toBe(2);
    expect((await db.query(`select count(*)::int n from marcacao_ponto`)).rows[0].n).toBe(antes - 2);
    expect((await db.query(`select status, relatorio->>'desfeitaMotivo' m from afd_importacao where id=$1`, [imp])).rows[0]).toEqual({ status: 'desfeita', m: 'Arquivo de outra empresa' });
    await expect(comoUsuario(db, rh, (c) => c.query(`select desfazer_importacao_afd($1,'de novo, por favor')`, [imp]))).rejects.toThrow(/já foi desfeita/);
    expect((await db.query(`select 1 from auditoria where tabela='afd_importacao' and registro_id=$1 and acao='desfazer'`, [imp])).rowCount).toBe(1);
    await expect(iniciar(rh, '1'.repeat(64), 'certo.txt')).resolves.toBeTruthy();         // depois de desfeito, o arquivo certo (mesmo hash) pode entrar
  });
  it('RH lê tudo; o colaborador lê só as próprias marcações; outra organização, nada', async () => {
    const ver = async (u: string) => (await comoUsuario(db, u, (c) => c.query(`select distinct colaborador_id from marcacao_ponto`))).rows.map((r) => r.colaborador_id);
    expect((await ver(rh)).length).toBeGreaterThan(1);
    expect(await ver(ua)).toEqual([A]);
    expect(await ver(uOrgB)).toEqual([]);
    expect((await comoUsuario(db, ua, (c) => c.query(`select 1 from afd_importacao`))).rowCount).toBe(0);
    expect((await comoUsuario(db, ua, (c) => c.query(`select 1 from ponto_identificador`))).rowCount).toBe(0);
  });
});
