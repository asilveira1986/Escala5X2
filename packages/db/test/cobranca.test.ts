import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client; let adm: string, rh: string, outro: string; let org: string, orgB: string, inicial: string, pro: string;
const evento = async (id: string, tipo: string, d: Record<string, unknown>) => (await db.query<{ r: Record<string, unknown> }>(`select aplicar_evento_cobranca('asaas',$1,$2,$3::jsonb) r`, [id, tipo, JSON.stringify(d)])).rows[0]!.r;
const assin = async () => (await db.query(`select status, teste_ate::text t, proximo_vencimento::text v, plano_id from assinatura where organizacao_id=$1`, [org])).rows[0];
const fat = async (ext: string) => (await db.query(`select status, valor_centavos, vencimento::text v, forma, url, pago_em from fatura where fatura_externa=$1`, [ext])).rows[0];
const base = { assinaturaExterna: 'sub_1', faturaExterna: 'pay_1', valorCentavos: 14900, vencimento: '2027-03-10', forma: 'pix', url: 'https://pagamento.exemplo/pay_1' };

beforeAll(async () => {
  db = await prepararBanco();
  adm = await novoUsuario(db, 'adm'); rh = await novoUsuario(db, 'rh'); outro = await novoUsuario(db, 'outro');
  org = await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('Org A','empresa') id`)).rows[0]!.id);
  orgB = await comoUsuario(db, outro, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('Org B','empresa') id`)).rows[0]!.id);
  await db.query(`insert into membro values ($1,$2,'rh')`, [org, rh]);
  inicial = (await db.query(`select id from plano where codigo='inicial'`)).rows[0].id; pro = (await db.query(`select id from plano where codigo='profissional'`)).rows[0].id;
});
afterAll(async () => { await db.end(); });

describe('assinatura e planos', () => {
  it('organização nova começa com 14 dias de teste no plano inicial; a de plataforma não tem assinatura', async () => {
    const a = await assin();
    const hoje = (await db.query(`select (hoje_sp() + 14)::text d`)).rows[0].d;
    expect(a).toMatchObject({ status: 'teste', t: hoje, plano_id: inicial });
    expect((await db.query(`select count(*)::int n from assinatura`)).rows[0].n).toBe(2);
    await db.query(`insert into organizacao (nome, tipo) values ('Plataforma','plataforma')`);
    expect((await db.query(`select count(*)::int n from assinatura`)).rows[0].n).toBe(2);
  });
  it('três planos de exemplo, visíveis a quem está logado', async () => {
    const p = await comoUsuario(db, rh, async (c) => (await c.query(`select codigo, preco_centavos, limite_colaboradores from plano order by ordem`)).rows);
    expect(p.map((x) => x.codigo)).toEqual(['inicial', 'profissional', 'empresarial']);
  });
});

describe('visibilidade e escrita', () => {
  it('membro vê o estado da assinatura da própria organização (não a de outra); fatura só o admin vê', async () => {
    await evento('e0', 'fatura_criada', { ...base, referencia: null });   // sem assinatura externa ainda: ignorado
    await db.query(`select definir_assinatura($1,$2,'asaas','cus_1','sub_1','pix','2027-03-10')`, [org, inicial]);
    await evento('e1', 'fatura_criada', base);
    expect((await comoUsuario(db, rh, async (c) => (await c.query(`select organizacao_id from assinatura`)).rows)).map((r) => r.organizacao_id)).toEqual([org]);
    expect((await comoUsuario(db, rh, async (c) => (await c.query(`select 1 from fatura`)).rows))).toEqual([]);
    expect((await comoUsuario(db, adm, async (c) => (await c.query(`select 1 from fatura`)).rows)).length).toBe(1);
    expect((await comoUsuario(db, outro, async (c) => (await c.query(`select 1 from fatura`)).rows))).toEqual([]);
  });
  it('ninguém escreve direto nem chama as funções do servidor', async () => {
    await expect(comoUsuario(db, adm, (c) => c.query(`update assinatura set status='ativa'`))).rejects.toThrow();
    await expect(comoUsuario(db, adm, (c) => c.query(`insert into fatura (organizacao_id, assinatura_id, provedor, fatura_externa, valor_centavos, vencimento, status) select organizacao_id, id, 'x','y',1,current_date,'paga' from assinatura`))).rejects.toThrow();
    await expect(comoUsuario(db, adm, (c) => c.query(`select definir_assinatura($1,$2,'asaas','c','s','pix','2027-01-01')`, [org, inicial]))).rejects.toThrow();
    await expect(comoUsuario(db, adm, (c) => c.query(`select aplicar_evento_cobranca('asaas','x','fatura_paga','{}')`))).rejects.toThrow();
    await expect(comoUsuario(db, adm, (c) => c.query(`select * from evento_cobranca`))).rejects.toThrow();
  });
});

describe('aplicar_evento_cobranca', () => {
  it('definir assinatura: aguarda o primeiro pagamento; plano inválido é recusado', async () => {
    expect(await assin()).toMatchObject({ status: 'aguardando_pagamento', v: '2027-03-10' });
    await expect(db.query(`select definir_assinatura($1,'00000000-0000-4000-8000-000000000000','asaas','c','s','pix','2027-01-01')`, [org])).rejects.toThrow(/plano inválido/);
  });
  it('fatura criada fica pendente; paga ativa a assinatura, guarda o pagamento e avisa os admins uma vez', async () => {
    expect(await fat('pay_1')).toMatchObject({ status: 'pendente', valor_centavos: 14900, forma: 'pix', url: 'https://pagamento.exemplo/pay_1' });
    const r = await evento('e2', 'fatura_paga', { ...base, pagoEm: '2027-03-09T15:00:00Z' });
    expect(r).toMatchObject({ status: 'paga' });
    expect(await assin()).toMatchObject({ status: 'ativa', v: '2027-04-10' });
    expect((await fat('pay_1')).pago_em).not.toBeNull();
    const n = (await db.query(`select tipo, titulo, href from notificacao where usuario_id=$1 and tipo like 'cobranca_%'`, [adm])).rows;
    expect(n).toEqual([{ tipo: 'cobranca_paga', titulo: 'Pagamento confirmado', href: '/cobranca' }]);
    expect((await db.query(`select 1 from notificacao where usuario_id=$1 and tipo like 'cobranca_%'`, [rh])).rowCount).toBe(0);     // só admin
  });
  it('é idempotente: o mesmo evento chegando de novo não muda nada nem avisa de novo', async () => {
    expect(await evento('e2', 'fatura_paga', base)).toEqual({ duplicado: true });
    expect((await db.query(`select 1 from notificacao where usuario_id=$1 and tipo like 'cobranca_%'`, [adm])).rowCount).toBe(1);
  });
  it('aviso atrasado não desfaz o pagamento (criada/vencida depois de paga)', async () => {
    await evento('e3', 'fatura_vencida', base);
    await evento('e4', 'fatura_criada', base);
    expect((await fat('pay_1')).status).toBe('paga');
    expect((await assin()).status).toBe('ativa');
  });
  it('fatura vencida de um ciclo novo deixa a assinatura inadimplente e avisa; pagar volta a ativa', async () => {
    const nova = { ...base, faturaExterna: 'pay_2', vencimento: '2027-04-10', url: 'https://pagamento.exemplo/pay_2' };
    await evento('e5', 'fatura_criada', nova);
    expect((await assin()).status).toBe('ativa');
    await evento('e6', 'fatura_vencida', nova);
    expect(await assin()).toMatchObject({ status: 'inadimplente' });
    expect((await db.query(`select titulo from notificacao where usuario_id=$1 and tipo='cobranca_vencida'`, [adm])).rows).toEqual([{ titulo: 'Fatura vencida' }]);
    await evento('e7', 'fatura_paga', { ...nova, pagoEm: '2027-04-20T10:00:00Z' });
    expect(await assin()).toMatchObject({ status: 'ativa', v: '2027-05-10' });
  });
  it('estorno marca a fatura e avisa; cancelamento da assinatura encerra; depois de cancelada, pagamento atrasado não reativa', async () => {
    await evento('e8', 'fatura_estornada', { ...base, faturaExterna: 'pay_2', vencimento: '2027-04-10' });
    expect((await fat('pay_2')).status).toBe('estornada');
    expect((await db.query(`select 1 from notificacao where usuario_id=$1 and tipo='cobranca_estornada'`, [adm])).rowCount).toBe(1);
    await evento('e9', 'assinatura_cancelada', { assinaturaExterna: 'sub_1' });
    expect((await assin()).status).toBe('cancelada');
    await evento('e10', 'fatura_paga', { ...base, faturaExterna: 'pay_3', vencimento: '2027-05-10' });
    expect((await assin()).status).toBe('cancelada');
  });
  it('evento de assinatura desconhecida ou de tipo desconhecido é registrado e ignorado, sem erro', async () => {
    expect(await evento('e11', 'fatura_paga', { ...base, assinaturaExterna: 'sub_x' })).toEqual({ ignorado: 'assinatura desconhecida' });
    expect(await evento('e12', 'coisa_estranha', base)).toEqual({ ignorado: 'tipo desconhecido' });
    expect((await db.query(`select count(*)::int n from evento_cobranca where evento_id in ('e11','e12')`)).rows[0].n).toBe(2);
  });
  it('encontra a assinatura também pela referência (id) quando o identificador externo ainda não chegou', async () => {
    const id = (await db.query(`select id from assinatura where organizacao_id=$1`, [orgB])).rows[0].id;
    await db.query(`update assinatura set provedor='asaas' where id=$1`, [id]);
    const r = await evento('e13', 'fatura_criada', { assinaturaExterna: 'sub_novo', referencia: id, faturaExterna: 'pay_b', valorCentavos: 39900, vencimento: '2027-06-01' });
    expect(r).toMatchObject({ status: 'pendente' });
  });
  it('trocar plano e cancelar (funções do servidor)', async () => {
    await db.query(`select trocar_plano_assinatura($1,$2)`, [orgB, pro]);
    expect((await db.query(`select plano_id from assinatura where organizacao_id=$1`, [orgB])).rows[0].plano_id).toBe(pro);
    await db.query(`select cancelar_assinatura_cobranca($1)`, [orgB]);
    expect((await db.query(`select status from assinatura where organizacao_id=$1`, [orgB])).rows[0].status).toBe('cancelada');
  });
});
