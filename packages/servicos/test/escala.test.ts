import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, novoUsuario, prepararBanco } from '../../db/test/helpers';
import { carregarEntradaEscala, ErroServico, publicarEscala, registrarCiencia, resumirHoras, validarEntrada, validarEscalaSalva } from '../src';
import { rpcPg, rpcPgServidor } from './pg-rpc';

let db: Client;
let rh: string, rhB: string, colabUser: string;
let orgA: string, emp: string, setor: string;
let c1: string, c2: string, c3: string, semContrato: string;

const somar = (d: string, i: number) => new Date(Date.parse(`${d}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
const servidor = () => rpcPgServidor(db);

async function novaEscala(periodo: string, nome = 'Janeiro') {
  return (await db.query<{ id: string }>(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,$2,$3,$4) returning id`, [emp, nome, periodo, rh])).rows[0]!.id;
}
async function turno(esc: string, colab: string, data: string, ini = 480, fim = 1020, interv = 60) {
  await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',$4,$5,$6)`, [esc, colab, data, ini, fim, interv]);
}
/** Cinco dias seguidos de 8h a partir de `inicio` (uma segunda-feira). */
async function semanaCincoDias(esc: string, colab: string, inicio: string) {
  for (let i = 0; i < 5; i++) await turno(esc, colab, somar(inicio, i));
}

beforeAll(async () => {
  db = await prepararBanco();
  rh = await novoUsuario(db, 'rh'); rhB = await novoUsuario(db, 'rhb'); colabUser = await novoUsuario(db, 'colab');
  orgA = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, rhB, (c) => c.query(`select criar_organizacao('B','empresa')`));
  await db.query(`insert into membro values ($1,$2,'colaborador')`, [orgA, colabUser]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'Loja','1','medio','3550308','SP') returning id`, [orgA])).rows[0].id;
  const un = (await db.query(`insert into unidade (empresa_id, nome, municipio_ibge) values ($1,'Matriz','3550308') returning id`, [emp])).rows[0].id;
  setor = (await db.query(`insert into setor (unidade_id, nome) values ($1,'Loja') returning id`, [un])).rows[0].id;
  const mk = async (nome: string, cpf: string, contrato: boolean, admissao = '2020-01-01') => {
    const id = (await db.query(`insert into colaborador (empresa_id, setor_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,$2,$3,cifrar_texto($4),hash_cpf($4),$5) returning id`, [emp, setor, nome, cpf, admissao])).rows[0].id;
    if (contrato) await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1,'[2020-01-01,)',3000,2400,200,'5x2')`, [id]);
    return id as string;
  };
  c1 = await mk('Ana', '11111111111', true); c2 = await mk('Bia', '22222222222', true); c3 = await mk('Caio', '33333333333', true);
  semContrato = await mk('Dani', '44444444444', false);
  await db.query(`update colaborador set usuario_id=$1 where id=$2`, [colabUser, c1]);
  await db.query(`insert into demanda_cobertura (empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal) values ($1,null,1,480,720,2,3)`, [emp]);
  await db.query(`insert into feriado (data, nome, abrangencia, municipio_ibge) values ('2027-01-05','Feriado de teste','municipal','3550308') on conflict do nothing`);
});
afterAll(async () => { await db.end(); });

describe('entrada e validação', () => {
  it('lê a entrada completa pelo RLS do usuário: colaboradores com contrato, sem contrato à parte, regras e feriados da empresa', async () => {
    const esc = await novaEscala('[2027-01-04,2027-01-11)');
    await semanaCincoDias(esc, c1, '2027-01-04');
    const e = await carregarEntradaEscala(rpcPg(db, rh), esc);
    expect(e.escala).toMatchObject({ status: 'rascunho', inicio: '2027-01-04', fim: '2027-01-10', empresaId: emp, setorId: null });
    expect(e.colaboradores.map((c) => c.nome)).toEqual(['Ana', 'Bia', 'Caio']);
    expect(e.colaboradores[0]).toMatchObject({ admissao: '2020-01-01', desligamento: null, tipoEscala: '5x2', jornadaSemanalMin: 2400 });
    expect(e.semContrato.map((c) => c.nome)).toEqual(['Dani']);
    expect(e.regras.length).toBe(8);
    expect(e.alocacoes).toHaveLength(5);
    expect(e.alocacoes[0]).toMatchObject({ colaboradorId: c1, data: '2027-01-04', tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 });
    expect(e.feriados.map((f) => f.nome)).toContain('Feriado de teste');
    expect(e.cobertura).toEqual([{ diaSemana: 1, faixaInicioMin: 480, faixaFimMin: 720, minimo: 2, ideal: 3 }]);
  });
  it('quem não pode ver a escala (outra organização ou colaborador) não consegue nem carregar a entrada', async () => {
    const esc = await novaEscala('[2027-02-01,2027-02-08)');
    await expect(carregarEntradaEscala(rpcPg(db, rhB), esc)).rejects.toThrow(/sem permissão/);
    await expect(carregarEntradaEscala(rpcPg(db, colabUser), esc)).rejects.toThrow(/sem permissão/);
  });
  it('5x2 válido não tem bloqueios; cobertura abaixo do ideal vira alerta/info; pode publicar', async () => {
    const esc = await novaEscala('[2027-03-01,2027-03-08)');
    await turno(esc, c1, '2027-03-01'); await turno(esc, c2, '2027-03-01');
    const r = await validarEscalaSalva(rpcPg(db, rh), esc);
    expect(r.bloqueios).toBe(0);
    expect(r.violacoes.map((v) => v.codigo)).toContain('COBERTURA_IDEAL');
    expect(r.podePublicar).toBe(true);
  });
  it('sem alocações não publica; lançar quem não tem contrato bloqueia com mensagem clara', async () => {
    const esc = await novaEscala('[2027-04-05,2027-04-12)');
    expect(validarEntrada(await carregarEntradaEscala(rpcPg(db, rh), esc)).podePublicar).toBe(false);
    await turno(esc, semContrato, '2027-04-05');
    const r = await validarEscalaSalva(rpcPg(db, rh), esc);
    expect(r.bloqueios).toBe(1);
    expect(r.violacoes[0]!.mensagem).toContain('Dani não tem contrato vigente');
    expect(r.podePublicar).toBe(false);
  });
  it('validação ao vivo: valida alocações editadas sem gravar', async () => {
    const esc = await novaEscala('[2027-05-03,2027-05-10)');
    await semanaCincoDias(esc, c1, '2027-05-03');
    const e = await carregarEntradaEscala(rpcPg(db, rh), esc);
    expect(validarEntrada(e).bloqueios).toBe(0);
    const editado = [...e.alocacoes, { colaboradorId: c1, data: '2027-05-08', tipo: 'trabalho' as const, inicioMin: 480, fimMin: 1020, intervaloMin: 60 }];
    expect(validarEntrada(e, editado).violacoes.map((v) => v.codigo)).toEqual(expect.arrayContaining(['FOLGAS_SEMANA', 'LIMITE_SEMANAL']));
    expect(validarEntrada(e).bloqueios).toBe(0); // nada foi gravado
  });
  it('interjornada considera turnos já publicados no período anterior', async () => {
    const jan = await novaEscala('[2027-06-07,2027-06-14)', 'Semana A');
    await turno(jan, c1, '2027-06-13', 1320, 1800); // domingo 22:00 → segunda 06:00
    await publicarEscala(rpcPg(db, rh), servidor(), jan, rh);
    const prox = await novaEscala('[2027-06-14,2027-06-21)', 'Semana B');
    await turno(prox, c1, '2027-06-14', 480, 1020, 60); // segunda 08:00: só 2h depois
    const r = await validarEscalaSalva(rpcPg(db, rh), prox);
    expect(r.violacoes.filter((v) => v.severidade === 'bloqueio').map((v) => v.codigo)).toEqual(['INTERJORNADA']);
  });
  it('resumo de horas por colaborador usa os limites vigentes', async () => {
    const esc = await novaEscala('[2027-07-05,2027-07-12)');
    await semanaCincoDias(esc, c1, '2027-07-05');
    const e = await carregarEntradaEscala(rpcPg(db, rh), esc);
    const ana = resumirHoras(e).find((r) => r.nome === 'Ana')!;
    expect(ana.horas).toMatchObject({ trabalhadasMin: 2400, extrasMin: 0, diasTrabalhados: 5 });
    expect(resumirHoras(e).find((r) => r.nome === 'Bia')!.horas.trabalhadasMin).toBe(0);
  });
});

describe('publicação', () => {
  it('publica com revalidação: grava hash, violações restantes e o ator', async () => {
    const esc = await novaEscala('[2027-08-02,2027-08-09)');
    await turno(esc, c1, '2027-08-02'); await turno(esc, c2, '2027-08-02');
    const r = await publicarEscala(rpcPg(db, rh), servidor(), esc, rh);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.versaoMotor).toBe('0.2.0');
    const linha = (await db.query(`select status, publicada_por, hash_publicado from escala where id=$1`, [esc])).rows[0];
    expect(linha).toMatchObject({ status: 'publicada', publicada_por: rh, hash_publicado: r.hash });
    expect((await db.query(`select count(*)::int n from violacao where escala_id=$1`, [esc])).rows[0].n).toBe(r.violacoes.length);
    await expect(publicarEscala(rpcPg(db, rh), servidor(), esc, rh)).rejects.toThrow(/rascunho/);
  });
  it('recusa escala com bloqueio, sem alocações ou de outra organização', async () => {
    const ruim = await novaEscala('[2027-09-06,2027-09-13)');
    await semanaCincoDias(ruim, c1, '2027-09-06'); await turno(ruim, c1, '2027-09-11'); await turno(ruim, c1, '2027-09-12');
    await expect(publicarEscala(rpcPg(db, rh), servidor(), ruim, rh)).rejects.toThrow(/bloqueio/);
    const vazia = await novaEscala('[2027-10-04,2027-10-11)');
    await expect(publicarEscala(rpcPg(db, rh), servidor(), vazia, rh)).rejects.toThrow(/nenhuma alocação/);
    await turno(vazia, c1, '2027-10-04');
    await expect(publicarEscala(rpcPg(db, rhB), servidor(), vazia, rhB)).rejects.toThrow(/sem permissão/);
    expect((await db.query(`select status from escala where id=$1`, [vazia])).rows[0].status).toBe('rascunho');
  });
  it('o cliente do usuário não consegue publicar sozinho (a função é do servidor)', async () => {
    const esc = await novaEscala('[2027-11-01,2027-11-08)');
    await turno(esc, c1, '2027-11-01');
    await expect(publicarEscala(rpcPg(db, rh), rpcPg(db, rh), esc, rh)).rejects.toThrow(/permission denied/);
  });
  it('ciência pelo colaborador após a publicação', async () => {
    const esc = await novaEscala('[2027-12-06,2027-12-13)');
    await turno(esc, c1, '2027-12-06');
    await expect(registrarCiencia(rpcPg(db, colabUser), esc)).rejects.toThrow(ErroServico);
    const { hash } = await publicarEscala(rpcPg(db, rh), servidor(), esc, rh);
    await registrarCiencia(rpcPg(db, colabUser), esc);
    expect((await db.query(`select hash_escala from ciencia where escala_id=$1`, [esc])).rows).toEqual([{ hash_escala: hash }]);
  });
});
