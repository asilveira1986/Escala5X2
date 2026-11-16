import { Pool } from 'pg';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { comoUsuario, dbUrl, novoUsuario, prepararBanco } from '../../packages/db/test/helpers';
import { armazenamentoLocal, enfileirarOtimizacaoAvulsa, enfileirarOtimizacao, iniciarFila, processarOtimizacao, registrarWorkers, type ConfigOtimizadorJob } from '../src';

let db: Client, pool: Pool;
let adm: string, org: string, emp: string, esc: string;
const colabs: string[] = [];
let turnoModelo = '';
const somar = (d: string, i: number) => new Date(Date.parse(`${d}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);

/** Otimizador de mentira: devolve uma escala fixa (5 dias de manhã por semana) para cada colaborador. */
function respostaCom(diasTrabalho: number, extra: Record<string, unknown> = {}) {
  const alocacoes = colabs.flatMap((id) => Array.from({ length: 7 }, (_, i) => i < diasTrabalho
    ? { colaboradorId: id, data: somar('2027-02-01', i), tipo: 'trabalho', turnoId: 'T', inicioMin: 480, fimMin: 1020, intervaloMin: 60 }
    : { colaboradorId: id, data: somar('2027-02-01', i), tipo: 'folga' }));
  return { status: 'otima', tempoMs: 12, solucoes: [{ status: 'otima', alocacoes, metricas: { faltaCobertura: 0, faltaIdeal: 0, deficitHorasMin: 0, domingosMin: 0, domingosMax: 0, preferenciasNaoAtendidas: 0, custoReais: 100, mudancasEmRelacaoReferencia: 0, objetivo: 100 } }], ...extra };
}
const cfg = (f: (url: string, init: RequestInit) => Promise<Response>, extra: Partial<ConfigOtimizadorJob> = {}): ConfigOtimizadorJob =>
  ({ url: 'http://otimizador', token: 't', fetchImpl: f as unknown as typeof fetch, esperaMs: 1, ...extra });
const ok = (body: unknown) => async () => new Response(JSON.stringify(body));

async function pedir(): Promise<string> {
  await db.query(`update otimizacao set status='erro' where escala_id=$1 and status in ('pendente','processando')`, [esc]);
  return comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select solicitar_otimizacao($1,'{"tempoLimiteS":5,"numSolucoes":1}') id`, [esc])).rows[0]!.id);
}
const estado = async (id: string) => (await db.query(`select status, erro, resumo, resultado from otimizacao where id=$1`, [id])).rows[0];

beforeAll(async () => {
  db = await prepararBanco();
  pool = new Pool({ connectionString: dbUrl });
  adm = await novoUsuario(db, 'adm');
  org = await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'Loja','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  for (let i = 0; i < 3; i++) {
    const id = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01') returning id`, [emp, `Pessoa ${i}`, `cpf${i}`])).rows[0].id as string;
    await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1,'[2020-01-01,)',3000,2400,200,'5x2')`, [id]);
    colabs.push(id);
  }
  await db.query(`insert into turno_modelo (empresa_id, nome, inicio_min, fim_min, intervalo_min) values ($1,'Manhã',480,1020,60)`, [emp]);
  esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Semana','[2027-02-01,2027-02-08)',$2) returning id`, [emp, adm])).rows[0].id;
  // o id do turno-modelo precisa bater com o `turnoId` devolvido pelo otimizador de mentira
  turnoModelo = (await db.query(`select id from turno_modelo where empresa_id=$1`, [emp])).rows[0].id as string;
});
afterAll(async () => { await pool.end(); await db.end(); });

const turnoId = () => turnoModelo;
const resp = (dias: number) => JSON.parse(JSON.stringify(respostaCom(dias)).replaceAll('"T"', `"${turnoModelo}"`));

describe('processarOtimizacao', () => {
  it('chama o otimizador com o problema montado, revalida e guarda as propostas (resumo sem alocações)', async () => {
    const id = await pedir();
    let corpo: any;
    const r = await processarOtimizacao(pool, id, cfg(async (url, init) => { corpo = JSON.parse(init.body as string); expect(url).toBe('http://otimizador/v1/otimizar'); return new Response(JSON.stringify(resp(5))); }));
    expect(r).toBe('concluida');
    expect(corpo.colaboradores).toHaveLength(3);
    expect(corpo.periodo).toEqual({ inicio: '2027-02-01', fim: '2027-02-07' });
    expect(corpo.tempoLimiteS).toBe(5);
    const e = await estado(id);
    expect(e.status).toBe('concluida');
    expect(e.resumo.propostas).toHaveLength(1);
    expect(e.resumo.propostas[0]).toMatchObject({ indice: 0, status: 'otima', metricas: { custoReais: 100 } });
    expect(e.resumo.propostas[0].alocacoes).toBeUndefined();               // resumo leve para a tela
    expect(e.resultado.propostas[0].alocacoes).toHaveLength(21);            // resultado completo, para aplicar
    expect(e.resultado.propostas[0].alocacoes[0]).toMatchObject({ tipo: 'trabalho', modeloId: turnoId(), inicioMin: 480 });
    expect(e.resumo.descartadas).toBe(0);
    const aud = (await db.query(`select usuario_id from auditoria where tabela='otimizacao' and registro_id=$1 and acao='update'`, [id])).rows;
    expect(aud.length).toBeGreaterThan(0);                                  // o worker grava (processando e concluída)
    expect(aud.every((x) => x.usuario_id === adm)).toBe(true);              // e as escritas ficam atribuídas a quem pediu
  });

  it('proposta com bloqueio é descartada pelo motor TypeScript e registrada no log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const id = await pedir();
    const r = await processarOtimizacao(pool, id, cfg(ok(resp(7))));       // 7 dias de trabalho: sem folga e acima de 42h
    expect(r).toBe('concluida');
    const e = await estado(id);
    expect(e.resumo.propostas).toEqual([]);
    expect(e.resumo.descartadas).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('divergência'), expect.objectContaining({ otimizacao: id, bloqueios: expect.arrayContaining(['FOLGAS_SEMANA']) }));
    spy.mockRestore();
  });

  it('inviável: guarda a mensagem do otimizador sem propostas', async () => {
    const id = await pedir();
    await processarOtimizacao(pool, id, cfg(ok({ status: 'inviavel', solucoes: [], mensagem: 'Não existe escala válida.', tempoMs: 3 })));
    const e = await estado(id);
    expect(e.status).toBe('concluida');
    expect(e.resumo).toMatchObject({ status: 'inviavel', mensagem: 'Não existe escala válida.', propostas: [] });
  });

  it('erros viram status "erro" com mensagem em português (rede, token, sem configuração)', async () => {
    let id = await pedir();
    expect(await processarOtimizacao(pool, id, cfg(async () => { throw new TypeError('fetch failed'); }))).toBe('erro');
    expect((await estado(id)).erro).toMatch(/Não foi possível falar com o otimizador/);
    id = await pedir();
    await processarOtimizacao(pool, id, cfg(async () => new Response('', { status: 401 })));
    expect((await estado(id)).erro).toMatch(/token/);
    id = await pedir();
    await processarOtimizacao(pool, id, null);
    expect((await estado(id)).erro).toMatch(/não está configurado/);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    id = await pedir();
    await processarOtimizacao(pool, id, cfg(ok({ lixo: true })));          // resposta fora do contrato: erro genérico, detalhe só no log
    expect((await estado(id)).erro).toMatch(/Falha inesperada/);
    spy.mockRestore();
  });

  it('otimizador ocupado (429): tenta de novo e conclui', async () => {
    const id = await pedir();
    let n = 0;
    const r = await processarOtimizacao(pool, id, cfg(async () => (++n < 3 ? new Response('', { status: 429 }) : new Response(JSON.stringify(resp(5))))));
    expect(r).toBe('concluida');
    expect(n).toBe(3);
  });

  it('ocupado o tempo todo: desiste com erro claro', async () => {
    const id = await pedir();
    expect(await processarOtimizacao(pool, id, cfg(async () => new Response('', { status: 429 }), { tentativasOcupado: 2 }))).toBe('erro');
    expect((await estado(id)).erro).toMatch(/ocupado/);
  });

  it('é idempotente: só processa pedido pendente', async () => {
    const id = await pedir();
    expect(await processarOtimizacao(pool, id, cfg(ok(resp(5))))).toBe('concluida');
    let chamou = false;
    expect(await processarOtimizacao(pool, id, cfg(async () => { chamou = true; return new Response('{}'); }))).toBeNull();
    expect(chamou).toBe(false);
    await expect(processarOtimizacao(pool, '00000000-0000-0000-0000-000000000000', null)).rejects.toThrow(/não encontrada/);
  });
});

describe('fila pg-boss: otimização ponta a ponta', () => {
  const esperar = async (id: string) => {
    let s = 'pendente';
    for (let i = 0; i < 60 && ['pendente', 'processando'].includes(s); i++) { await new Promise((r) => setTimeout(r, 400)); s = (await estado(id)).status; }
    return s;
  };
  it('enfileira, o worker processa e o app web pode enfileirar de forma avulsa', async () => {
    const boss = await iniciarFila(dbUrl);
    try {
      await registrarWorkers(boss, pool, armazenamentoLocal('/tmp'), cfg(ok(resp(5))));
      let id = await pedir();
      expect(await enfileirarOtimizacao(boss, id)).toBeTruthy();
      expect(await enfileirarOtimizacao(boss, id)).toBeNull();               // sem duplicar
      expect(await esperar(id)).toBe('concluida');
      id = await pedir();
      expect(await enfileirarOtimizacaoAvulsa(dbUrl, id)).toBeTruthy();
      expect(await esperar(id)).toBe('concluida');
    } finally {
      await boss.stop({ graceful: false, wait: true });
    }
  }, 30_000);
});
