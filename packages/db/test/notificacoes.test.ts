import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client; let rh: string, contador: string, ua: string, ub: string, uc: string, estranho: string, lider: string;
let org: string, emp: string, A: string, B: string, esc: string, hoje: string;
const dia = (n: number) => new Date(Date.parse(`${hoje}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const das = async (u: string) => (await db.query(`select tipo, titulo, texto, href, empresa_id, lida_em from notificacao where usuario_id=$1 order by criado_em, id`, [u])).rows;
const tipos = async (u: string) => (await das(u)).map((n) => n.tipo);
const como = (u: string, sql: string, p: unknown[] = []) => comoUsuario(db, u, async (c) => (await c.query(sql, p)).rows);
const criar = (u: string, colab: string, payload: unknown, dest: string | null) => comoUsuario(db, u, async (c) => (await c.query<{ id: string }>(`select criar_solicitacao($1,'troca_turno',$2::jsonb,$3,'Consulta') id`, [colab, JSON.stringify(payload), dest])).rows[0]!.id);

beforeAll(async () => {
  db = await prepararBanco();
  hoje = (await db.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
  rh = await novoUsuario(db, 'rh'); contador = await novoUsuario(db, 'contador'); ua = await novoUsuario(db, 'ua'); ub = await novoUsuario(db, 'ub'); uc = await novoUsuario(db, 'uc');
  estranho = await novoUsuario(db, 'estranho'); lider = await novoUsuario(db, 'lider');
  org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, estranho, (c) => c.query(`select criar_organizacao('B','empresa')`));
  for (const u of [ua, ub, uc]) await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, u]);
  await db.query(`insert into membro values ($1,$2,'lider')`, [org, lider]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string, u: string | null) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4) returning id`, [emp, n, cpf, u])).rows[0].id as string;
  A = await mk('Ana', '1', ua); B = await mk('Bia', '2', ub); await mk('Sem acesso', '3', null);
  esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Pub',daterange($2::date,$3::date),$4) returning id`, [emp, dia(10), dia(40), rh])).rows[0].id;
  for (const [c, d] of [[A, 12], [A, 14], [B, 13], [B, 15]] as const) await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',480,1020,60)`, [esc, c, dia(d)]);
});
afterAll(async () => { await db.end(); });

describe('escala publicada', () => {
  it('avisa só quem tem acesso e está na escala; rascunho não avisa; a mesma publicação não avisa duas vezes', async () => {
    expect(await tipos(ua)).toEqual([]);
    await db.query('begin'); await db.query(`select set_config('app.publicando','1',true)`);
    await db.query(`update escala set status='publicada', publicada_em=now(), hash_publicado='h' where id=$1`, [esc]); await db.query('commit');
    const n = await das(ua);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ tipo: 'escala_publicada', href: '/minha-escala', empresa_id: emp, lida_em: null });
    expect(n[0].titulo).toMatch(/^Escala de \d{2}\/\d{4} publicada$/);
    expect(await tipos(ub)).toEqual(['escala_publicada']);
    expect(await tipos(uc)).toEqual([]);          // não está na escala
    expect(await tipos(rh)).toEqual([]);          // gestão não recebe (ela publicou)
  });
});

describe('pedidos', () => {
  let id: string;
  it('troca de turno nova: avisa o colega (e só ele)', async () => {
    id = await criar(ua, A, { escalaId: esc, dataSolicitante: dia(12), dataColega: dia(13) }, B);
    const n = (await das(ub)).at(-1)!;
    expect(n).toMatchObject({ tipo: 'pedido_para_voce', href: '/minha-escala/pedidos' });
    expect(n.titulo).toBe('Ana pediu uma troca de turno com você');
    expect(await tipos(rh)).toEqual([]);
  });
  it('colega aceita: avisa a solicitante e a gestão (RH e contador vinculado), com link para os pedidos da empresa', async () => {
    await db.query(`insert into membro values ($1,$2,'admin')`, [org, contador]);
    await como(ub, `select responder_solicitacao($1,true)`, [id]);
    expect((await das(ua)).at(-1)).toMatchObject({ tipo: 'pedido_colega_aceitou' });
    const g = (await das(rh)).at(-1)!;
    expect(g).toMatchObject({ tipo: 'pedido_novo', href: `/empresas/${emp}/solicitacoes` });
    expect(g.titulo).toBe('Novo pedido de troca de turno: Ana');
    expect(await tipos(contador)).toEqual(['pedido_novo']);   // admin da organização gere a empresa
    expect(await tipos(lider)).toEqual([]);                   // líder não decide pedidos
    expect(await tipos(estranho)).toEqual([]);                // outra organização
  });
  it('RH aprova: avisa a solicitante e o colega; recusa avisa com o motivo', async () => {
    await como(rh, `select decidir_solicitacao($1,true,null,null)`, [id]);
    expect((await das(ua)).at(-1)).toMatchObject({ tipo: 'pedido_decidido', titulo: 'Seu pedido de troca de turno foi aprovado' });
    expect((await das(ub)).at(-1)).toMatchObject({ tipo: 'pedido_decidido', href: '/minha-escala' });
    const id2 = await criar(ua, A, { escalaId: esc, dataSolicitante: dia(14), dataColega: dia(15) }, B);
    await como(ub, `select responder_solicitacao($1,true)`, [id2]);
    await como(rh, `select decidir_solicitacao($1,false,'Cobertura insuficiente',null)`, [id2]);
    expect((await das(ua)).at(-1)).toMatchObject({ titulo: 'Seu pedido de troca de turno foi recusado', texto: 'Cobertura insuficiente' });
  });
  it('colega recusa e cancelamento enquanto aguarda: cada lado é avisado', async () => {
    const a = await criar(ua, A, { escalaId: esc, dataSolicitante: dia(12), dataColega: dia(15) }, B);
    await como(ub, `select responder_solicitacao($1,false)`, [a]);
    expect((await das(ua)).at(-1)!.titulo).toBe('O colega recusou a sua troca de turno');
    const b = await criar(ua, A, { escalaId: esc, dataSolicitante: dia(14), dataColega: dia(13) }, B);
    await como(ua, `select cancelar_solicitacao($1)`, [b]);
    expect((await das(ub)).at(-1)).toMatchObject({ tipo: 'pedido_cancelado' });
  });
  it('férias pedidas direto ao RH: avisa a gestão, não o colega', async () => {
    const antes = (await das(rh)).length, antesB = (await das(ub)).length;
    await comoUsuario(db, ua, (c) => c.query(`select criar_solicitacao($1,'ferias',$2::jsonb,null,null)`, [A, JSON.stringify({ inicio: dia(60), fim: dia(70) })]));
    expect((await das(rh)).length).toBe(antes + 1);
    expect((await das(rh)).at(-1)!.titulo).toBe('Novo pedido de férias: Ana');
    expect((await das(ub)).length).toBe(antesB);
  });
});

describe('privacidade e proteção', () => {
  it('cada pessoa vê só as suas; ninguém insere, apaga nem altera o conteúdo; só marca como lida', async () => {
    const minhas = await como(ua, `select id, usuario_id from notificacao`);
    expect(minhas.length).toBeGreaterThan(0);
    expect(minhas.every((n) => n.usuario_id === ua)).toBe(true);
    expect(await como(estranho, `select 1 from notificacao`)).toEqual([]);
    await expect(como(ua, `insert into notificacao (organizacao_id, usuario_id, tipo, titulo) values ($1,$2,'teste','x')`, [org, ua])).rejects.toThrow();
    await expect(como(ua, `delete from notificacao`)).rejects.toThrow();
    await expect(como(ua, `update notificacao set titulo='hack'`)).rejects.toThrow();
    const o = (await das(ub))[0]!;
    const alheia = (await db.query(`select id from notificacao where usuario_id=$1 limit 1`, [ub])).rows[0].id;
    expect(await como(ua, `update notificacao set lida_em = now() where id=$1 returning id`, [alheia])).toEqual([]);   // não enxerga, não altera
    expect(o.lida_em).toBeNull();
  });
  it('marcar como lida funciona, não desfaz, e a função interna não é chamável por usuário', async () => {
    const [n] = await como(ua, `update notificacao set lida_em = now() where lida_em is null returning id`);
    expect(n).toBeTruthy();
    await expect(como(ua, `update notificacao set lida_em = null where id=$1`, [n!.id])).rejects.toThrow(/marcada como lida/);
    await expect(como(ua, `select notificar($1,$2,'x_y_z','t')`, [ua, emp])).rejects.toThrow();
    await expect(como(ua, `select usuarios_gestores_empresa($1)`, [emp])).rejects.toThrow();
  });
});
