import { Pool } from 'pg';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, dbUrl, novoUsuario, prepararBanco } from '../../packages/db/test/helpers';
import { AGENDA_ALERTAS_CONFORMIDADE, processarAlertasConformidade } from '../src';

let db: Client, pool: Pool, rh: string, emp: string;

beforeAll(async () => {
  db = await prepararBanco();
  pool = new Pool({ connectionString: dbUrl });
  rh = await novoUsuario(db, 'rh');
  const org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const c = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Ana',cifrar_texto('1'),hash_cpf('1'),'2020-01-01') returning id`, [emp])).rows[0].id;
  await db.query(`insert into contrato_versao (organizacao_id, colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1,$2,'[2020-01-01,)',3000,2640,220,'6x1')`, [org, c]);
});
afterAll(async () => { await pool.end(); await db.end(); });

describe('processarAlertasConformidade', () => {
  it('agenda às 8h10 de Brasília', () => {
    expect(AGENDA_ALERTAS_CONFORMIDADE).toEqual({ cron: '10 8 * * *', tz: 'America/Sao_Paulo' });
  });
  it('avisa a gestão e devolve o resumo; rodar de novo no mesmo dia não duplica', async () => {
    expect(await processarAlertasConformidade(pool, { hoje: '2026-11-17' })).toEqual({ empresas: 1, avisos: 1 });    // fase 1 a 28 dias (a escala de dezembro ainda está a 14 dias: fora da janela)
    expect(await processarAlertasConformidade(pool, { hoje: '2026-11-17' })).toEqual({ empresas: 1, avisos: 0 });
    expect(await processarAlertasConformidade(pool, { hoje: '2026-11-22' })).toEqual({ empresas: 1, avisos: 1 });    // 9 dias para 1º/12: escala pendente
    expect((await db.query(`select tipo from notificacao where usuario_id = $1 order by tipo`, [rh])).rows.map((n) => n.tipo)).toEqual(['conformidade_ec', 'escala_pendente']);
  });
});
