/**
 * Ponta a ponta com o otimizador de verdade: banco → solicitar_otimizacao → worker → serviço Python (OR-Tools) →
 * revalidação TypeScript → resultado → aplicar na grade → validar → publicar. Pula sem apps/optimizer/.venv.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carregarEntradaEscala, publicarEscala, validarEntrada, validarEscalaSalva } from '@jc/servicos';
import { comoUsuario, dbUrl, novoUsuario, prepararBanco } from '../../packages/db/test/helpers';
import { rpcPg, rpcPgServidor } from '../../packages/servicos/test/pg-rpc';
import { processarOtimizacao } from '../src';

const dir = join(import.meta.dirname, '../../apps/optimizer');
const python = join(dir, '.venv/bin/python');
const TEM = existsSync(python);
const TOKEN = 'token-de-teste';

async function portaLivre(): Promise<number> {
  return new Promise((resolve) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
}

describe.skipIf(!TEM)('geração automática de escala: ponta a ponta com o otimizador real', () => {
  let db: Client, pool: Pool, proc: ChildProcess, url = '';
  let adm: string, esc: string;
  beforeAll(async () => {
    const porta = await portaLivre(); url = `http://127.0.0.1:${porta}`;
    proc = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--port', String(porta), '--log-level', 'warning'], { cwd: dir, env: { ...process.env, OPTIMIZER_TOKEN: TOKEN }, stdio: 'ignore' });
    db = await prepararBanco(); pool = new Pool({ connectionString: dbUrl });
    adm = await novoUsuario(db, 'adm');
    const org = await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
    const emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'Loja','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
    await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) select $1, 'Pessoa ' || lpad(g::text, 2, '0'), cifrar_texto('c' || g), hash_cpf('c' || g), '2022-01-01' from generate_series(1, 30) g`, [emp]);
    await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) select id, '[2022-01-01,)', 2500, 2400, 200, '5x2' from colaborador where empresa_id=$1`, [emp]);
    await db.query(`insert into turno_modelo (empresa_id, nome, inicio_min, fim_min, intervalo_min) values ($1,'Manhã',480,1020,60), ($1,'Meio',600,1140,60), ($1,'Tarde',720,1260,60)`, [emp]);
    await db.query(`insert into demanda_cobertura (empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal) select $1, null, d, 780, 1020, case when d in (0,6) then 10 else 16 end, 20 from generate_series(0,6) d`, [emp]);
    await db.query(`insert into ausencia (empresa_id, colaborador_id, periodo, tipo) select $1, id, '[2027-02-15,2027-02-22)', 'ferias' from colaborador where empresa_id=$1 and nome in ('Pessoa 03','Pessoa 13','Pessoa 23')`, [emp]);
    esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Fevereiro','[2027-02-01,2027-03-01)',$2) returning id`, [emp, adm])).rows[0].id;
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* subindo */ } await new Promise((r) => setTimeout(r, 250)); }
    throw new Error('o otimizador não subiu');
  }, 40_000);
  afterAll(async () => { proc?.kill(); await pool?.end(); await db?.end(); });

  it('gera propostas reais, aplica a melhor na grade e publica sem nenhum bloqueio', async () => {
    const id = await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select solicitar_otimizacao($1,'{"tempoLimiteS":20,"numSolucoes":3}') id`, [esc])).rows[0]!.id);
    const t = Date.now();
    expect(await processarOtimizacao(pool, id, { url, token: TOKEN })).toBe('concluida');
    const dt = (Date.now() - t) / 1000;
    expect(dt).toBeLessThan(30);
    const o = (await db.query(`select status, resumo, resultado from otimizacao where id=$1`, [id])).rows[0];
    expect(o.resumo.descartadas).toBe(0);
    expect(o.resumo.propostas.length).toBeGreaterThanOrEqual(1);
    const melhor = o.resultado.propostas[0];
    expect(melhor.metricas.faltaCobertura).toBe(0);
    expect(melhor.metricas.deficitHorasMin).toBe(0);

    // aplicar: revalida contra o estado atual e grava com a trava de revisão (o que a tela faz)
    const cliente = rpcPg(db, adm);
    const entrada = await carregarEntradaEscala(cliente, esc);
    expect(validarEntrada(entrada, melhor.alocacoes).bloqueios).toBe(0);
    const grav = melhor.alocacoes.map((a: any) => ({ colaboradorId: a.colaboradorId, data: a.data, tipo: a.tipo, inicioMin: a.inicioMin ?? null, fimMin: a.fimMin ?? null, intervaloMin: a.intervaloMin ?? 0, turnoModeloId: a.modeloId ?? null }));
    const r = await cliente.rpc('salvar_alocacoes', { p_escala: esc, p_revisao: entrada.escala.revisao, p_alocacoes: grav });
    expect(r.error).toBeNull();
    expect((await db.query(`select count(*)::int n from alocacao where escala_id=$1 and turno_modelo_id is not null`, [esc])).rows[0].n).toBeGreaterThan(30 * 15);

    // a escala gravada passa na validação do servidor e pode ser publicada
    const v = await validarEscalaSalva(cliente, esc);
    expect(v.bloqueios).toBe(0);
    expect(v.podePublicar).toBe(true);
    const pub = await publicarEscala(cliente, rpcPgServidor(db), esc, adm);
    expect(pub.hash).toMatch(/^[0-9a-f]{64}$/);
    console.log(`ponta a ponta: ${dt.toFixed(1)}s, ${o.resumo.propostas.length} propostas, publicada com hash ${pub.hash.slice(0, 12)}…`);
  }, 90_000);
});
