import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client; let rh: string, ua: string, ub: string, estranho: string; let org: string, emp: string, A: string, B: string, C: string;
const item = (c: string, extra = {}) => ({ colaboradorId: c, inicio: '2026-12-15', jornadaAtualMin: 2640, novaJornadaMin: 2520, diasTrabalho: 5, diasRepouso: 2, ...extra });
const emitir = (u: string, fase: string, itens: unknown[]) => comoUsuario(db, u, async (c) => (await c.query<{ r: { novos: number; atualizados: number; mantidos: number } }>(`select emitir_comunicados($1,$2,$3::jsonb) r`, [emp, fase, JSON.stringify(itens)])).rows[0]!.r);
const notifs = async (u: string) => (await db.query(`select titulo, texto, href from notificacao where usuario_id=$1 and tipo='comunicado_jornada' order by criado_em`, [u])).rows;
const auditoria = async () => (await db.query(`select acao from auditoria where tabela='comunicado_jornada' order by id`)).rows.map((r) => r.acao);

beforeAll(async () => {
  db = await prepararBanco();
  rh = await novoUsuario(db, 'rh'); ua = await novoUsuario(db, 'ua'); ub = await novoUsuario(db, 'ub'); estranho = await novoUsuario(db, 'estranho');
  org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, estranho, (c) => c.query(`select criar_organizacao('B','empresa')`));
  for (const u of [ua, ub]) await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, u]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string, u: string | null) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4) returning id`, [emp, n, cpf, u])).rows[0].id as string;
  A = await mk('Ana', '1', ua); B = await mk('Bia', '2', ub); C = await mk('Caio', '3', null);
});
afterAll(async () => { await db.end(); });

describe('comunicados de adequação de jornada', () => {
  it('a gestão emite; quem tem acesso é avisado; fica na auditoria; ninguém de fora emite', async () => {
    expect(await emitir(rh, 'F1', [item(A), item(B), item(C)])).toEqual({ novos: 3, atualizados: 0, mantidos: 0 });
    const n = await notifs(ua);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ titulo: 'Comunicado: a sua jornada de trabalho vai mudar', href: '/minha-escala/comunicados' });
    expect(n[0].texto).toContain('A partir de 15/12/2026 a sua jornada passa a 42h por semana');
    expect(await auditoria()).toEqual(['emitir_f1']);
    await expect(emitir(estranho, 'F1', [item(A)])).rejects.toThrow(/Sem permissão/);
    await expect(emitir(ua, 'F1', [item(A)])).rejects.toThrow(/Sem permissão/);         // colaborador não emite
    await expect(emitir(rh, 'F3', [item(A)])).rejects.toThrow(/Fase inválida/);
    await expect(emitir(rh, 'F1', 'x' as never)).rejects.toThrow();
  });
  it('emitir de novo com os mesmos valores mantém tudo (inclusive a ciência); valor diferente atualiza e exige nova ciência', async () => {
    const id = (await db.query(`select id from comunicado_jornada where colaborador_id=$1 and fase='F1'`, [A])).rows[0].id as string;
    await comoUsuario(db, ua, (c) => c.query(`select registrar_ciencia_comunicado($1)`, [id]));
    expect(await emitir(rh, 'F1', [item(A), item(B)])).toEqual({ novos: 0, atualizados: 0, mantidos: 2 });
    expect((await db.query(`select ciente_em from comunicado_jornada where id=$1`, [id])).rows[0].ciente_em).not.toBeNull();
    expect((await notifs(ua)).length).toBe(1);                                            // sem aviso repetido
    expect(await emitir(rh, 'F1', [item(A, { novaJornadaMin: 2400 })])).toEqual({ novos: 0, atualizados: 1, mantidos: 0 });
    const x = (await db.query(`select ciente_em, nova_jornada_min from comunicado_jornada where id=$1`, [id])).rows[0];
    expect(x).toMatchObject({ ciente_em: null, nova_jornada_min: 2400 });
    expect((await notifs(ua)).length).toBe(2);
  });
  it('a ciência é só do próprio colaborador, uma vez, e fica auditada', async () => {
    const idB = (await db.query(`select id from comunicado_jornada where colaborador_id=$1 and fase='F1'`, [B])).rows[0].id as string;
    await expect(comoUsuario(db, ua, (c) => c.query(`select registrar_ciencia_comunicado($1)`, [idB]))).rejects.toThrow(/não encontrado/);   // Ana não dá ciência pela Bia
    await expect(comoUsuario(db, rh, (c) => c.query(`select registrar_ciencia_comunicado($1)`, [idB]))).rejects.toThrow(/não encontrado/);   // nem a gestão
    await comoUsuario(db, ub, (c) => c.query(`select registrar_ciencia_comunicado($1)`, [idB]));
    const antes = (await db.query(`select ciente_em from comunicado_jornada where id=$1`, [idB])).rows[0].ciente_em;
    await comoUsuario(db, ub, (c) => c.query(`select registrar_ciencia_comunicado($1)`, [idB]));
    expect((await db.query(`select ciente_em from comunicado_jornada where id=$1`, [idB])).rows[0].ciente_em).toEqual(antes);
    expect((await auditoria()).filter((a) => a === 'ciencia').length).toBe(2);                 // Ana (antes) e Bia, a segunda tentativa não duplica
  });
  it('RLS: o colaborador vê só o próprio; a gestão vê todos; de fora não vê; ninguém escreve direto', async () => {
    expect(await comoUsuario(db, ua, async (c) => (await c.query(`select colaborador_id from comunicado_jornada`)).rows.map((r) => r.colaborador_id))).toEqual([A]);
    expect((await comoUsuario(db, rh, async (c) => (await c.query(`select 1 from comunicado_jornada`)).rowCount))).toBe(3);
    expect(await comoUsuario(db, estranho, async (c) => (await c.query(`select 1 from comunicado_jornada`)).rowCount)).toBe(0);
    await expect(comoUsuario(db, rh, (c) => c.query(`update comunicado_jornada set ciente_em = now()`))).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(db, rh, (c) => c.query(`delete from comunicado_jornada`))).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(db, ua, (c) => c.query(`insert into comunicado_jornada (organizacao_id, empresa_id, colaborador_id, fase, inicio, jornada_atual_min, nova_jornada_min, dias_trabalho, dias_repouso) values ($1,$2,$3,'F2','2027-12-15',2640,2400,5,2)`, [org, emp, A]))).rejects.toThrow();
  });
  it('colaborador de outra empresa é ignorado; o download do PDF é auditado só para a gestão', async () => {
    expect(await emitir(rh, 'F2', [item('00000000-0000-4000-8000-000000000000')])).toEqual({ novos: 0, atualizados: 0, mantidos: 0 });
    await comoUsuario(db, rh, (c) => c.query(`select registrar_download_comunicados($1,'F1')`, [emp]));
    expect(await auditoria()).toContain('baixar_pdf_f1');
    await expect(comoUsuario(db, ua, (c) => c.query(`select registrar_download_comunicados($1,'F1')`, [emp]))).rejects.toThrow(/Sem permissão/);
  });
});
