import { Pool } from 'pg';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, dbUrl, novoUsuario, prepararBanco } from '../../packages/db/test/helpers';
import { AGENDA_AVISO_BANCO, processarAvisoVencimento } from '../src';

let db: Client, pool: Pool;
let rh: string, ua: string, ub: string, org: string, emp: string, empB: string, A: string, B: string, D: string;
const HOJE = '2027-03-10';
const lanc = (c: string, e: string, data: string, minutos: number, vence: string | null, origem = 'manual') =>
  db.query(`insert into banco_horas_lancamento (organizacao_id, empresa_id, colaborador_id, data, minutos, origem, vence_em) values ((select organizacao_id from empresa where id=$2),$2,$1,$3,$4,$5,$6)`, [c, e, data, minutos, origem, vence]);
const das = async (u: string) => (await db.query(`select tipo, titulo from notificacao where usuario_id=$1 and tipo like 'banco_%' order by tipo, criado_em`, [u])).rows;

beforeAll(async () => {
  db = await prepararBanco();
  pool = new Pool({ connectionString: dbUrl });
  rh = await novoUsuario(db, 'rh'); ua = await novoUsuario(db, 'ua'); ub = await novoUsuario(db, 'ub');
  org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  for (const u of [ua, ub]) await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, u]);
  const mkEmp = async (n: string) => (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,$2,$3,'medio','3550308','SP') returning id`, [org, n, n])).rows[0].id as string;
  emp = await mkEmp('E1'); empB = await mkEmp('E2');
  const mk = async (e: string, n: string, cpf: string, u: string | null, desl: string | null = null) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id, desligamento) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4,$5) returning id`, [e, n, cpf, u, desl])).rows[0].id as string;
  A = await mk(emp, 'Ana', '1', ua); B = await mk(emp, 'Bia', '2', ub); D = await mk(emp, 'Dani', '4', null, '2027-01-31');
  await mk(empB, 'Eva', '5', null);
  // Ana: 2h vencem em 20 dias + 1h já vencida; Bia: crédito longe do vencimento (nada); Dani (desligada): 3h vencidas e 1h que "venceria" em breve
  await lanc(A, emp, '2026-10-01', 120, '2027-03-30'); await lanc(A, emp, '2026-08-01', 60, '2027-02-01');
  await lanc(B, emp, '2026-12-01', 300, '2027-09-01');
  await lanc(D, emp, '2026-06-01', 180, '2026-12-01'); await lanc(D, emp, '2026-12-20', 60, '2027-03-25');
});
afterAll(async () => { await pool.end(); await db.end(); });

describe('processarAvisoVencimento', () => {
  it('avisa quem tem crédito vencendo ou vencido; ignora quem está longe do vencimento; desligado só entra pelo vencido (na gestão)', async () => {
    const r = await processarAvisoVencimento(pool, { hoje: HOJE });
    expect(r).toEqual({ empresas: 1, colaboradores: 2, avisos: 2 });     // Ana e Dani; Dani não tem acesso e a Bia não está perto
    expect((await das(ua)).map((n) => n.titulo)).toEqual(['Banco de horas: 2h vencem em breve', 'Banco de horas: 1h vencidas']);
    expect(await das(ub)).toEqual([]);
    const g = await das(rh);
    expect(g).toEqual([{ tipo: 'banco_gestao', titulo: 'Banco de horas: 2 colaboradores com horas vencendo ou vencidas' }]);
    const texto = (await db.query(`select texto from notificacao where usuario_id=$1 and tipo='banco_gestao'`, [rh])).rows[0].texto;
    expect(texto).toBe('2h vencem em até 30 dias; 4h já vencidas (a pagar como hora extra).');   // 1h da Ana + 3h da Dani; a 1h a vencer da Dani não conta
  });
  it('rodar de novo no mesmo dia não duplica nada', async () => {
    const r = await processarAvisoVencimento(pool, { hoje: HOJE });
    expect(r.avisos).toBe(2);                                             // calculou de novo, mas o banco recusou os repetidos
    expect((await das(ua)).length).toBe(2);
    expect((await das(rh)).length).toBe(1);
  });
  it('compensação desconta do crédito mais antigo: depois de compensar tudo o que vence, o aviso não vem na semana seguinte', async () => {
    await lanc(A, emp, '2027-03-12', -120, null, 'compensacao');
    await processarAvisoVencimento(pool, { hoje: '2027-03-17' });
    expect((await das(ua)).filter((n) => n.tipo === 'banco_vencendo').length).toBe(1);   // sem novo aviso de "vencem em breve"
    expect((await das(rh)).length).toBe(2);                                              // a gestão continua com o vencido da Dani
  });
  it('a agenda é diária às 8h de Brasília', () => {
    expect(AGENDA_AVISO_BANCO).toEqual({ cron: '0 8 * * *', tz: 'America/Sao_Paulo' });
  });
});
