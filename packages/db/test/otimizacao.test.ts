import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let adm: string, outro: string, colab: string;
let org: string, emp: string, c1: string, esc: string;
const pedir = (uid: string, escala = esc, opc: unknown = {}) =>
  comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(`select solicitar_otimizacao($1,$2::jsonb) id`, [escala, JSON.stringify(opc)])).rows[0]!.id);
const finalizar = (id: string) => db.query(`update otimizacao set status='concluida', concluido_em=now() where id=$1`, [id]);

beforeAll(async () => {
  db = await prepararBanco();
  adm = await novoUsuario(db, 'adm'); outro = await novoUsuario(db, 'outro'); colab = await novoUsuario(db, 'colab');
  org = await comoUsuario(db, adm, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, outro, (c) => c.query(`select criar_organizacao('B','empresa')`));
  await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, colab]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  c1 = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,'Ana',cifrar_texto('1'),hash_cpf('1'),'2020-01-01') returning id`, [emp])).rows[0].id;
  await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1,'[2020-01-01,)',3000,2400,200,'5x2')`, [c1]);
  esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'x','[2027-02-01,2027-03-01)',$2) returning id`, [emp, adm])).rows[0].id;
});
afterAll(async () => { await db.end(); });

describe('solicitar_otimizacao', () => {
  it('exige ao menos um turno cadastrado', async () => {
    await expect(pedir(adm)).rejects.toThrow(/Cadastre ao menos um turno/);
  });
  it('grava o retrato da escala e as opções (tempo e número de propostas limitados), com o turno da empresa', async () => {
    await db.query(`insert into turno_modelo (empresa_id, nome, inicio_min, fim_min, intervalo_min) values ($1,'Manhã',480,1020,60), ($1,'Inativo',0,60,0)`, [emp]);
    await db.query(`update turno_modelo set ativo=false where nome='Inativo'`);
    const id = await pedir(adm, esc, { tempoLimiteS: 9999, numSolucoes: 9 });
    const r = (await db.query(`select * from otimizacao where id=$1`, [id])).rows[0];
    expect(r).toMatchObject({ status: 'pendente', empresa_id: emp, escala_id: esc, criado_por: adm, organizacao_id: org });
    expect(r.opcoes).toMatchObject({ tempoLimiteS: 60, numSolucoes: 3, usarRascunhoComoReferencia: false });
    expect(r.opcoes.turnos).toEqual([expect.objectContaining({ inicioMin: 480, fimMin: 1020, intervaloMin: 60 })]);   // o inativo fica de fora
    expect(r.entrada.escala).toMatchObject({ id: esc, status: 'rascunho', inicio: '2027-02-01', fim: '2027-02-28' });
    expect(r.entrada.colaboradores).toHaveLength(1);
    expect(r.revisao_escala).toBe(1);
    await finalizar(id);
  });
  it('só uma geração ativa por escala; depois de concluída, pode pedir outra', async () => {
    const a = await pedir(adm);
    await expect(pedir(adm)).rejects.toThrow(/em andamento/);
    await finalizar(a);
    const b = await pedir(adm, esc, { tempoLimiteS: 1, numSolucoes: 0 });
    expect((await db.query(`select opcoes from otimizacao where id=$1`, [b])).rows[0].opcoes).toMatchObject({ tempoLimiteS: 5, numSolucoes: 1 });
    await finalizar(b);
  });
  it('otimização presa há mais de 10 minutos é encerrada como erro e libera um novo pedido', async () => {
    const a = await pedir(adm);
    await db.query(`update otimizacao set criado_em = now() - interval '11 minutes', status='processando' where id=$1`, [a]);
    const b = await pedir(adm);
    expect((await db.query(`select status, erro from otimizacao where id=$1`, [a])).rows[0]).toMatchObject({ status: 'erro', erro: expect.stringMatching(/Tempo esgotado/) });
    await finalizar(b);
  });
  it('pedido que nunca entrou na fila expira em 2 minutos; cancelar libera na hora (só quem gere)', async () => {
    const a = await pedir(adm);
    await expect(pedir(adm)).rejects.toThrow(/em andamento/);
    await expect(comoUsuario(db, outro, (c) => c.query(`select cancelar_otimizacao($1)`, [a]))).rejects.toThrow(/sem permissão/);
    await comoUsuario(db, adm, (c) => c.query(`select cancelar_otimizacao($1)`, [a]));
    expect((await db.query(`select status, erro from otimizacao where id=$1`, [a])).rows[0]).toEqual({ status: 'erro', erro: 'Cancelada.' });
    const b = await pedir(adm);
    await db.query(`update otimizacao set criado_em = now() - interval '3 minutes' where id=$1`, [b]);
    const c = await pedir(adm);                                   // o pendente velho foi encerrado
    expect((await db.query(`select erro from otimizacao where id=$1`, [b])).rows[0].erro).toMatch(/fila indisponível/);
    await finalizar(c);
    await comoUsuario(db, adm, (cl) => cl.query(`select cancelar_otimizacao($1)`, [c]));   // concluída: não muda
    expect((await db.query(`select status from otimizacao where id=$1`, [c])).rows[0].status).toBe('concluida');
  });
  it('recusa quem não gere a empresa e escala que não é rascunho', async () => {
    await expect(pedir(outro)).rejects.toThrow(/sem permissão/);
    await expect(pedir(colab)).rejects.toThrow(/sem permissão/);
    const pub = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'p','[2027-05-01,2027-06-01)',$2) returning id`, [emp, adm])).rows[0].id;
    await db.query('begin'); await db.query(`select set_config('app.publicando','1',true)`);
    await db.query(`update escala set status='publicada', publicada_em=now(), hash_publicado='h' where id=$1`, [pub]); await db.query('commit');
    await expect(pedir(adm, pub)).rejects.toThrow(/Só rascunhos/);
  });
  it('a tela lê pelo RLS: gestão vê; colaborador e outra organização não; ninguém escreve direto', async () => {
    expect((await comoUsuario(db, adm, (c) => c.query(`select 1 from otimizacao`))).rowCount).toBeGreaterThan(0);
    expect((await comoUsuario(db, colab, (c) => c.query(`select 1 from otimizacao`))).rowCount).toBe(0);
    expect((await comoUsuario(db, outro, (c) => c.query(`select 1 from otimizacao`))).rowCount).toBe(0);
    await expect(comoUsuario(db, adm, (c) => c.query(`update otimizacao set status='concluida'`))).rejects.toThrow();
    await expect(comoUsuario(db, adm, (c) => c.query(`insert into otimizacao (organizacao_id, empresa_id, escala_id, revisao_escala, entrada, opcoes) values ($1,$2,$3,1,'{}','{}')`, [org, emp, esc]))).rejects.toThrow();
  });
  it('o pedido é auditado', async () => {
    const r = await db.query(`select count(*)::int n from auditoria where tabela='otimizacao' and acao='solicitar'`);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});
