import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, dbUrl, novoUsuario, prepararBanco } from '../../packages/db/test/helpers';
import { armazenamentoLocal, enfileirarImportacao, iniciarFila, processarImportacao, registrarWorkers } from '../src';

let db: Client, pool: Pool, dir: string;
let rh: string, outro: string, org: string, orgB: string, emp: string;
const MAP = { nome: 'Nome', cpf: 'CPF', admissao: 'Admissão', salario: 'Salário', jornada_semanal: 'Jornada', tipo_escala: 'Escala', escolaridade: 'Escolaridade', setor: 'Setor' };
const CAB = 'Nome;CPF;Admissão;Salário;Jornada;Escala;Escolaridade;Setor';
const csv = (...linhas: string[]) => [CAB, ...linhas].join('\r\n');

async function novaImportacao(nome: string, conteudo: string, mapeamento: object = MAP): Promise<string> {
  await mkdir(join(dir, org), { recursive: true });
  await writeFile(join(dir, org, nome), conteudo, 'utf8');
  return comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(
    `insert into importacao (empresa_id, tipo, arquivo_path, mapeamento, criado_por) values ($1,'colaboradores',$2,$3,$4) returning id`,
    [emp, `${org}/${nome}`, JSON.stringify(mapeamento), rh])).rows[0]!.id);
}
const relatorioDe = async (id: string) => (await db.query(`select status, relatorio from importacao where id=$1`, [id])).rows[0];

beforeAll(async () => {
  db = await prepararBanco();
  await db.query(`do $$ begin execute format('alter database %I set app.chave_dados = %L', current_database(), 'chave-de-teste'); end $$`);
  pool = new Pool({ connectionString: dbUrl });
  dir = await mkdtemp(join(tmpdir(), 'jc-imp-'));
  rh = await novoUsuario(db, 'rh'); outro = await novoUsuario(db, 'outro');
  const org_ = (u: string, n: string) => comoUsuario(db, u, async (c) => (await c.query<{ id: string }>(`select criar_organizacao($1,'empresa') id`, [n])).rows[0]!.id);
  org = await org_(rh, 'Org'); orgB = await org_(outro, 'Outra');
  emp = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(
    `insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'Loja','1','medio','3550308','SP') returning id`, [org])).rows[0]!.id);
});
afterAll(async () => {
  await db.query(`do $$ begin execute format('alter database %I reset app.chave_dados', current_database()); end $$`);
  await pool.end(); await db.end(); await rm(dir, { recursive: true, force: true });
});

const armazem = () => armazenamentoLocal(dir);

describe('processarImportacao', () => {
  it('cria colaboradores, contratos, setor e unidade; grava PII cifrada e audita em nome do usuário', async () => {
    const id = await novaImportacao('a.csv', csv(
      'Ana Souza;111.444.777-35;01/03/2020;2.500,00;44;6x1;Médio;Loja',
      'Bia Lima;529.982.247-25;15/06/2021;3.000,00;40;5x2;Superior;Loja',
      'Caio;000.000.000-00;01/01/2020;1.000,00;44;6x1;Médio;Estoque'));
    const rel = await processarImportacao(pool, id, armazem(), { hoje: '2026-10-28' });
    expect(rel).toMatchObject({ totalLinhas: 3, criados: 2, atualizados: 0, errosTotal: 1, setoresCriados: 1 });
    expect(rel!.erros[0]).toMatchObject({ linha: 4, campo: 'cpf' });
    expect((await relatorioDe(id)).status).toBe('concluida');

    const c = await db.query(`select nome, cpf_cifrado, setor_id, organizacao_id from colaborador order by nome`);
    expect(c.rows.map((r) => r.nome)).toEqual(['Ana Souza', 'Bia Lima']);
    expect(c.rows[0].organizacao_id).toBe(org);
    expect(Buffer.from(c.rows[0].cpf_cifrado).toString('latin1')).not.toContain('11144477735');
    const k = await db.query(`select cv.salario_base::text s, cv.jornada_semanal_min j, cv.divisor d, cv.tipo_escala t, cv.vigencia::text v from contrato_versao cv join colaborador c on c.id=cv.colaborador_id where c.nome='Ana Souza'`);
    expect(k.rows).toEqual([{ s: '2500.00', j: 2640, d: 220, t: '6x1', v: '[2020-03-01,)' }]);
    expect((await db.query(`select count(*)::int n from unidade where empresa_id=$1`, [emp])).rows[0].n).toBe(1);
    const aud = await db.query(`select distinct usuario_id from auditoria where tabela='colaborador' and acao='insert'`);
    expect(aud.rows).toEqual([{ usuario_id: rh }]);
  });

  it('é idempotente: reprocessar uma importação concluída não faz nada', async () => {
    const id = (await db.query(`select id from importacao limit 1`)).rows[0].id;
    expect(await processarImportacao(pool, id, armazem())).toBeNull();
  });

  it('reimportar a mesma planilha não altera nada; mudar salário abre nova versão do contrato', async () => {
    const igual = await novaImportacao('b.csv', csv(
      'Ana Souza;111.444.777-35;01/03/2020;2.500,00;44;6x1;Médio;Loja',
      'Bia Lima;529.982.247-25;15/06/2021;3.000,00;40;5x2;Superior;Loja'));
    expect(await processarImportacao(pool, igual, armazem(), { hoje: '2026-11-01' })).toMatchObject({ criados: 0, atualizados: 0, semAlteracao: 2, errosTotal: 0 });

    const muda = await novaImportacao('c.csv', csv('Ana Souza;111.444.777-35;01/03/2020;2.700,00;40;5x2;Médio;Loja'));
    expect(await processarImportacao(pool, muda, armazem(), { hoje: '2026-12-01' })).toMatchObject({ criados: 0, atualizados: 1 });
    const v = await db.query(`select salario_base::text s, jornada_semanal_min j, tipo_escala t, vigencia::text v from contrato_versao cv join colaborador c on c.id=cv.colaborador_id where c.nome='Ana Souza' order by lower(vigencia)`);
    expect(v.rows).toEqual([
      { s: '2500.00', j: 2640, t: '6x1', v: '[2020-03-01,2026-12-01)' },
      { s: '2700.00', j: 2400, t: '5x2', v: '[2026-12-01,)' },
    ]);
  });

  it('alteração no mesmo dia corrige a versão em vigor, sem criar vigência vazia', async () => {
    const id = await novaImportacao('d.csv', csv('Ana Souza;111.444.777-35;01/03/2020;2.800,00;40;5x2;Médio;Loja'));
    await processarImportacao(pool, id, armazem(), { hoje: '2026-12-01' });
    const v = await db.query(`select salario_base::text s from contrato_versao cv join colaborador c on c.id=cv.colaborador_id where c.nome='Ana Souza' order by lower(vigencia)`);
    expect(v.rows.map((r) => r.s)).toEqual(['2500.00', '2800.00']);
  });

  it('falha geral (arquivo inexistente) marca a importação como erro', async () => {
    const id = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(
      `insert into importacao (empresa_id, tipo, arquivo_path, mapeamento, criado_por) values ($1,'colaboradores',$2,$3,$4) returning id`,
      [emp, `${org}/nao-existe.csv`, JSON.stringify(MAP), rh])).rows[0]!.id);
    await expect(processarImportacao(pool, id, armazem())).rejects.toThrow();
    const r = await relatorioDe(id);
    expect(r.status).toBe('erro');
    expect(r.relatorio.mensagem).toBeTruthy();
  });

  it('o worker recusa caminho fora da pasta da organização mesmo que o banco seja contornado', async () => {
    // desliga o gatilho só para simular um banco comprometido; o worker precisa recusar mesmo assim
    await db.query(`alter table importacao disable trigger importacao_validar`);
    try {
      const id = (await db.query<{ id: string }>(
        `insert into importacao (organizacao_id, empresa_id, tipo, arquivo_path, mapeamento, criado_por) values ($1,$2,'colaboradores',$3,$4,$5) returning id`,
        [org, emp, `${orgB}/roubado.csv`, JSON.stringify(MAP), rh])).rows[0]!.id;
      await expect(processarImportacao(pool, id, armazem())).rejects.toThrow(/fora da pasta/);
    } finally {
      await db.query(`alter table importacao enable trigger importacao_validar`);
    }
  });

  it('o armazenamento local não sai do diretório', async () => {
    await expect(armazem().ler('../etc/passwd')).rejects.toThrow(/fora do diretório/);
  });

  it('importa 200 colaboradores em poucos segundos', async () => {
    const cpf = (n: number) => { const b = String(300_000_000 + n); const dv = (s: string) => { let t = 0; for (let i = 0; i < s.length; i++) t += +s[i]! * (s.length + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; }; const d1 = dv(b); return b + d1 + dv(b + d1); };
    const linhas = Array.from({ length: 200 }, (_, i) => `Pessoa ${i};${cpf(i)};01/01/2022;2.000,00;44;6x1;Médio;Setor ${i % 5}`);
    const id = await novaImportacao('grande.csv', csv(...linhas));
    const t = Date.now();
    const rel = await processarImportacao(pool, id, armazem(), { hoje: '2026-10-28' });
    expect(rel).toMatchObject({ criados: 200, errosTotal: 0, setoresCriados: 5 });
    expect(Date.now() - t).toBeLessThan(15_000);
  });
});

describe('fila pg-boss', () => {
  it('enfileira, processa e conclui a importação ponta a ponta', async () => {
    const id = await novaImportacao('fila.csv', csv('Duda;168.995.350-09;01/01/2022;2.100,00;44;6x1;Médio;Loja'));
    const boss = await iniciarFila(dbUrl);
    try {
      await registrarWorkers(boss, pool, armazem());
      expect(await enfileirarImportacao(boss, id)).toBeTruthy();
      expect(await enfileirarImportacao(boss, id)).toBeNull(); // singleton: sem duplicar
      let status = 'processando';
      for (let i = 0; i < 60 && status === 'processando'; i++) {
        await new Promise((r) => setTimeout(r, 500));
        status = (await relatorioDe(id)).status;
      }
      expect(status).toBe('concluida');
      expect((await relatorioDe(id)).relatorio).toMatchObject({ criados: 1 });
    } finally {
      await boss.stop({ graceful: false, wait: true });
    }
  });
});
