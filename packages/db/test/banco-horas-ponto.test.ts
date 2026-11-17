import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client; let rh: string, lider: string, estranho: string, ua: string;
let org: string, emp: string, A: string, B: string, hoje: string;
const dia = (n: number) => new Date(Date.parse(`${hoje}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
type R = { lancados: number; recusados: { colaboradorId: string; data: string; motivo: string }[] };
const lote = (uid: string, itens: unknown[]) => comoUsuario(db, uid, async (c) => (await c.query<{ r: R }>(`select lancar_banco_horas_ponto($1,$2::jsonb) r`, [emp, JSON.stringify(itens)])).rows[0]!.r);
const item = (c: string, data: string, minutos: number, descricao?: string) => ({ colaboradorId: c, data, minutos, descricao });
const saldo = async (c: string) => Number((await db.query(`select coalesce(sum(minutos),0)::int s from banco_horas_lancamento where colaborador_id=$1`, [c])).rows[0].s);

beforeAll(async () => {
  db = await prepararBanco();
  hoje = (await db.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
  rh = await novoUsuario(db, 'rh'); lider = await novoUsuario(db, 'lider'); estranho = await novoUsuario(db, 'estranho'); ua = await novoUsuario(db, 'ua');
  org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, estranho, (c) => c.query(`select criar_organizacao('B','empresa')`));
  await db.query(`insert into membro values ($1,$2,'lider')`, [org, lider]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01') returning id`, [emp, n, cpf])).rows[0].id as string;
  A = await mk('Ana', '1'); B = await mk('Bia', '2');
  const acordo = (await db.query(`insert into acordo_coletivo (organizacao_id, empresa_id, tipo, vigencia, status) values ($1,$2,'acordo',daterange('2020-01-01',null),'vigente') returning id`, [org, emp])).rows[0].id;
  await db.query(`insert into clausula_jornada (acordo_id, tipo, parametros) values ($1,'banco_horas','{"prazo_meses":6,"limite_saldo_min":300,"limite_negativo_min":120}')`, [acordo]);
  await db.query(`insert into colaborador_acordo (colaborador_id, acordo_id) values ($1,$2)`, [A, acordo]);   // só a Ana tem banco de horas
});
afterAll(async () => { await db.end(); });

describe('lancar_banco_horas_ponto', () => {
  it('lança crédito (com vencimento pela cláusula) e débito, com origem ponto, e audita o lote', async () => {
    const r = await lote(rh, [item(A, dia(-5), 90, 'Ponto: saída 1h30 depois'), item(A, dia(-4), -30, 'Ponto: atraso')]);
    expect(r).toEqual({ lancados: 2, recusados: [] });
    const l = (await db.query(`select data::text d, minutos, origem, descricao, vence_em::text v, criado_por from banco_horas_lancamento where colaborador_id=$1 order by data`, [A])).rows;
    const venc = (await db.query(`select (($1::date) + interval '6 months')::date::text v`, [dia(-5)])).rows[0].v;
    expect(l).toEqual([{ d: dia(-5), minutos: 90, origem: 'ponto', descricao: 'Ponto: saída 1h30 depois', v: venc, criado_por: rh }, { d: dia(-4), minutos: -30, origem: 'ponto', descricao: 'Ponto: atraso', v: null, criado_por: rh }]);
    expect((await db.query(`select 1 from auditoria where tabela='banco_horas_lancamento' and acao like 'lote_ponto:2/2'`)).rowCount).toBe(1);
    expect(await saldo(A)).toBe(60);
  });

  it('um item recusado não derruba os outros e volta com o motivo (sem acordo, mesmo dia, futuro, minutos inválidos, outra empresa)', async () => {
    const r = await lote(rh, [
      item(A, dia(-3), 30),                // ok
      item(B, dia(-3), 60),                // Bia sem acordo: crédito recusado
      item(A, dia(-5), 15),                // dia já lançado pelo ponto
      item(A, dia(2), 10),                 // futuro
      item(A, dia(-2), 0),                 // minutos inválidos
      item('00000000-0000-4000-8000-000000000000', dia(-2), 10),   // colaborador que não é desta empresa
    ]);
    expect(r.lancados).toBe(1);
    const motivos = Object.fromEntries(r.recusados.map((x) => [`${x.colaboradorId}|${x.data}`, x.motivo]));
    expect(motivos[`${B}|${dia(-3)}`]).toMatch(/Sem acordo com banco de horas/);
    expect(motivos[`${A}|${dia(-5)}`]).toMatch(/já foi lançado pelo ponto/);
    expect(motivos[`${A}|${dia(2)}`]).toMatch(/futura/);
    expect(motivos[`${A}|${dia(-2)}`]).toMatch(/Minutos inválidos/);
    expect(r.recusados).toHaveLength(5);
  });

  it('débito sem banco de horas dentro do limite negativo é permitido; passando do limite, recusado; teto de saldo vale para crédito', async () => {
    const neg = await lote(rh, [item(B, dia(-20), -100)]);                // Bia sem acordo: limite negativo padrão é 0
    expect(neg.lancados).toBe(0); expect(neg.recusados[0]!.motivo).toMatch(/abaixo do permitido/);
    const saldoA = await saldo(A);
    const teto = await lote(rh, [item(A, dia(-6), 300 - saldoA + 1)]);    // passaria do teto de 5 h
    expect(teto.lancados).toBe(0); expect(teto.recusados[0]!.motivo).toMatch(/limite do acordo/);
    const justo = await lote(rh, [item(A, dia(-6), 300 - saldoA)]);
    expect(justo.lancados).toBe(1);
    expect(await saldo(A)).toBe(300);
  });

  it('depois de estornar, o dia pode ser lançado de novo', async () => {
    const id = (await db.query(`select id from banco_horas_lancamento where colaborador_id=$1 and data=$2 and origem='ponto'`, [A, dia(-4)])).rows[0].id;
    await comoUsuario(db, rh, (c) => c.query(`select estornar_banco_horas($1,'Lançado por engano')`, [id]));
    const r = await lote(rh, [item(A, dia(-4), -15, 'Ponto: atraso corrigido')]);
    expect(r.lancados).toBe(1);
  });

  it('só a gestão lança: líder, pessoa de fora e colaborador são recusados; lote vazio ou enorme também', async () => {
    await expect(lote(lider, [item(A, dia(-1), 10)])).rejects.toThrow(/sem permissão/);
    await expect(lote(estranho, [item(A, dia(-1), 10)])).rejects.toThrow(/sem permissão/);
    await expect(lote(rh, [])).rejects.toThrow(/Nenhum item/);
    await expect(lote(rh, Array.from({ length: 2001 }, () => item(A, dia(-1), 1)))).rejects.toThrow(/Itens demais/);
  });
});
