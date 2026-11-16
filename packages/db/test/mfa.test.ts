import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let ana: string, rh: string, org: string, emp: string;
const PLAT = '00000000-0000-0000-0000-000000000001';

const ver = (uid: string, aal: 'aal1' | 'aal2') => comoUsuario(db, uid, (c) => c.query('select id from empresa'), aal);
const definir = (ativo: boolean) => db.query(`select definir_mfa_obrigatorio($1, 'teste de integração')`, [ativo]);

beforeAll(async () => {
  db = await prepararBanco();
  ana = await novoUsuario(db, 'ana');
  rh = await novoUsuario(db, 'rh');
  org = await comoUsuario(db, ana, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('Org','empresa') id`)).rows[0]!.id);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','1','SP') returning id`, [org])).rows[0].id;
  await db.query(`insert into membro values ($1,$2,'rh')`, [org, rh]);
});
afterAll(async () => { await db.end(); });

describe('interruptor do MFA', () => {
  it('padrão seguro: ligado, e admin sem MFA não enxerga dados', async () => {
    expect((await db.query('select mfa_obrigatorio() v')).rows[0].v).toBe(true);
    expect((await ver(ana, 'aal1')).rowCount).toBe(0);
    expect((await ver(ana, 'aal2')).rows.map((r) => r.id)).toEqual([emp]);
  });

  it('desligado: admin entra sem MFA; RH continua igual', async () => {
    await definir(false);
    expect((await db.query('select mfa_obrigatorio() v')).rows[0].v).toBe(false);
    expect((await ver(ana, 'aal1')).rows.map((r) => r.id)).toEqual([emp]);
    expect((await ver(rh, 'aal1')).rows.map((r) => r.id)).toEqual([emp]);
  });

  it('religado: volta a exigir MFA', async () => {
    await definir(true);
    expect((await ver(ana, 'aal1')).rowCount).toBe(0);
    expect((await ver(ana, 'aal2')).rowCount).toBe(1);
  });

  it('fail-secure: valor inválido ou linha ausente contam como LIGADO', async () => {
    for (const valor of [`'"false"'::jsonb`, `'0'::jsonb`, `'null'::jsonb`, `'{"a":1}'::jsonb`]) {
      await db.query(`update configuracao_sistema set valor = ${valor} where chave = 'mfa_obrigatorio'`);
      expect((await db.query('select mfa_obrigatorio() v')).rows[0].v, valor).toBe(true);
      expect((await ver(ana, 'aal1')).rowCount, valor).toBe(0);
    }
    await db.query(`delete from configuracao_sistema where chave = 'mfa_obrigatorio'`);
    expect((await db.query('select mfa_obrigatorio() v')).rows[0].v).toBe(true);
    expect((await ver(ana, 'aal1')).rowCount).toBe(0);
    await db.query(`insert into configuracao_sistema (chave, valor, motivo) values ('mfa_obrigatorio', 'true'::jsonb, 'restaurado')`);
  });

  it('exige motivo para mudar', async () => {
    await expect(db.query(`select definir_mfa_obrigatorio(false, '  ')`)).rejects.toThrow(/motivo/);
    await expect(db.query(`select definir_mfa_obrigatorio(false, null)`)).rejects.toThrow(/motivo/);
  });

  it('usuários do app não leem nem alteram a configuração nem chamam a função de mudança', async () => {
    await expect(comoUsuario(db, ana, (c) => c.query('select * from configuracao_sistema'), 'aal2')).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(db, ana, (c) => c.query(`update configuracao_sistema set valor = 'false'::jsonb`), 'aal2')).rejects.toThrow(/permission denied/);
    await expect(comoUsuario(db, ana, (c) => c.query(`select definir_mfa_obrigatorio(false, 'tentativa de burla')`), 'aal2')).rejects.toThrow(/permission denied/);
    expect((await db.query('select mfa_obrigatorio() v')).rows[0].v).toBe(true);
  });

  it('o app (authenticated) consegue perguntar o estado; anônimo não', async () => {
    const r = await comoUsuario(db, ana, (c) => c.query('select mfa_obrigatorio() v'), 'aal1');
    expect(r.rows[0].v).toBe(true);
    await db.query('begin');
    await db.query('set local role anon');
    await expect(db.query('select mfa_obrigatorio()')).rejects.toThrow(/permission denied/);
    await db.query('rollback');
  });

  it('cada mudança fica na auditoria com o motivo', async () => {
    await db.query(`select definir_mfa_obrigatorio(false, 'motivo exclusivo da auditoria')`);
    await db.query(`select definir_mfa_obrigatorio(true, 'motivo exclusivo da auditoria')`);
    const a = await db.query(`select acao, depois ->> 'motivo' as motivo, (depois -> 'valor')::text as valor from auditoria
                               where organizacao_id = $1 and tabela = 'configuracao_sistema' and acao = 'update' and depois ->> 'motivo' = 'motivo exclusivo da auditoria' order by id`, [PLAT]);
    expect(a.rows.map((r) => r.valor)).toEqual(['false', 'true']);
  });
});
