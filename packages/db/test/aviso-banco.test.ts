import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client; let rh: string, ua: string, ub: string, estranho: string; let org: string, emp: string, A: string, B: string, C: string;
const avisar = async (hoje: string, itens: unknown[]) => (await db.query<{ r: { colaboradores: number; avisosColaborador: number } }>(`select avisar_vencimento_banco($1,$2::date,$3::jsonb) r`, [emp, hoje, JSON.stringify(itens)])).rows[0]!.r;
const das = async (u: string) => (await db.query(`select tipo, titulo, texto, href, chave from notificacao where usuario_id=$1 and tipo like 'banco_%' order by tipo, criado_em`, [u])).rows;

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

describe('avisar_vencimento_banco', () => {
  it('avisa o colaborador (a vencer e vencido) e a gestão; formata horas e data; só o worker chama', async () => {
    const r = await avisar('2027-03-10', [{ colaboradorId: A, aVencerMin: 150, venceEm: '2027-04-02', vencidoMin: 60 }, { colaboradorId: B, aVencerMin: 45, venceEm: '2027-03-20', vencidoMin: 0 }, { colaboradorId: C, aVencerMin: 0, venceEm: null, vencidoMin: 480 }]);
    expect(r).toEqual({ colaboradores: 3, avisosColaborador: 3 });
    const a = await das(ua);
    expect(a.map((n) => n.tipo)).toEqual(['banco_vencendo', 'banco_vencido']);
    expect(a[0]).toMatchObject({ titulo: 'Banco de horas: 2h30 vencem em breve', href: '/minha-escala/banco-horas', chave: `banco_vencendo:${A}:2027-W10` });
    expect(a[0].texto).toContain('02/04/2027');
    expect(a[1]).toMatchObject({ titulo: 'Banco de horas: 1h vencidas', chave: `banco_vencido:${A}:2027-03` });
    expect((await das(ub))[0]!.titulo).toBe('Banco de horas: 45min vencem em breve');
    const g = await das(rh);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ tipo: 'banco_gestao', href: `/empresas/${emp}/banco-horas`, titulo: 'Banco de horas: 3 colaboradores com horas vencendo ou vencidas' });
    expect(g[0].texto).toBe('3h15 vencem em até 30 dias; 9h já vencidas (a pagar como hora extra).');
    expect(await das(estranho)).toEqual([]);
    await expect(comoUsuario(db, rh, (c) => c.query(`select avisar_vencimento_banco($1,'2027-03-10','[]')`, [emp]))).rejects.toThrow();
  });
  it('rodar de novo na mesma semana não duplica; semana seguinte avisa a vencer de novo; o vencido só no mês seguinte', async () => {
    const itens = [{ colaboradorId: A, aVencerMin: 150, venceEm: '2027-04-02', vencidoMin: 60 }];
    await avisar('2027-03-11', itens);
    expect((await das(ua)).length).toBe(2);
    expect((await das(rh)).length).toBe(1);
    await avisar('2027-03-17', itens);                                   // semana 11, mesmo mês
    expect((await das(ua)).map((n) => n.tipo)).toEqual(['banco_vencendo', 'banco_vencendo', 'banco_vencido']);
    expect((await das(rh)).length).toBe(2);
    await avisar('2027-04-01', itens);                                   // outro mês: vencido de novo
    expect((await das(ua)).filter((n) => n.tipo === 'banco_vencido').length).toBe(2);
  });
  it('item sem horas, colaborador de outra empresa e pessoa sem acesso não geram aviso de colaborador; sem itens não avisa a gestão', async () => {
    const antesRh = (await das(rh)).length;
    const r = await avisar('2027-06-01', [{ colaboradorId: A, aVencerMin: 0, vencidoMin: 0 }, { colaboradorId: '00000000-0000-4000-8000-000000000000', aVencerMin: 60, venceEm: '2027-06-10', vencidoMin: 0 }]);
    expect(r).toEqual({ colaboradores: 0, avisosColaborador: 0 });
    expect((await das(rh)).length).toBe(antesRh);
    await expect(avisar('2027-06-01', 'x' as never)).rejects.toThrow();
  });
  it('a notificação continua só marcável como lida e o aviso (com chave) aparece para o dono', async () => {
    const minhas = await comoUsuario(db, ua, async (c) => (await c.query(`select tipo from notificacao where tipo like 'banco_%'`)).rows);
    expect(minhas.length).toBeGreaterThan(0);
    await expect(comoUsuario(db, ua, (c) => c.query(`update notificacao set chave = 'x'`))).rejects.toThrow();
  });
});
