import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client; let rh: string, colab: string, estranho: string; let org: string, emp: string;
const avisar = async (hoje: string) => (await db.query<{ r: { empresas: number; avisos: number } }>(`select avisar_conformidade($1::date) r`, [hoje])).rows[0]!.r;
const dos = async (u: string, tipo: string) => (await db.query(`select titulo, texto, href, chave from notificacao where usuario_id=$1 and tipo=$2 order by criado_em, id`, [u, tipo])).rows;

beforeAll(async () => {
  db = await prepararBanco();
  rh = await novoUsuario(db, 'rh'); colab = await novoUsuario(db, 'colab'); estranho = await novoUsuario(db, 'estranho');
  org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, estranho, (c) => c.query(`select criar_organizacao('B','empresa')`));
  await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, colab]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string, u: string | null, jornada: number, tipo: string, folgas: number | null) => {
    const id = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4) returning id`, [emp, n, cpf, u])).rows[0].id as string;
    await db.query(`insert into contrato_versao (organizacao_id, colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala, folgas_semana) values ($1,$2,'[2020-01-01,)',3000,$3,220,$4,$5)`, [org, id, jornada, tipo, folgas]);
    return id;
  };
  await mk('Ana', '1', colab, 2640, '6x1', null);        // 44h em 6x1
  await mk('Bia', '2', null, 2640, '6x1', 1);
  await mk('Caio', '3', null, 2400, '5x2', null);        // 40h em 5x2: já pronto
});
afterAll(async () => { await db.end(); });

describe('avisar_conformidade: EC 141', () => {
  it('a 28 dias da fase 1, avisa só a gestão com a contagem de quem não atende', async () => {
    const r = await avisar('2026-11-17');
    expect(r.empresas).toBe(1);
    const g = await dos(rh, 'conformidade_ec');
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ titulo: 'EC 141: faltam 28 dias para a fase 1', href: `/empresas/${emp}/prontidao` });
    expect(g[0].texto).toContain('2 de 3 colaboradores ainda não atendem a jornada e as folgas da fase 1 (15/12/2026)');
    expect(g[0].chave).toBe(`ec141:${emp}:EC141_F1:30`);
    expect(await dos(colab, 'conformidade_ec')).toEqual([]);
    expect(await dos(estranho, 'conformidade_ec')).toEqual([]);
  });
  it('não repete no mesmo marco; avisa de novo quando entra o marco seguinte', async () => {
    await avisar('2026-11-17'); await avisar('2026-11-20');          // 25 dias: ainda o marco de 30
    expect((await dos(rh, 'conformidade_ec')).length).toBe(1);
    await avisar('2026-11-30');                                       // 15 dias: marco de 15
    await avisar('2026-12-10');                                       // 5 dias: marco de 7
    expect((await dos(rh, 'conformidade_ec')).map((n) => n.chave.split(':').pop())).toEqual(['30', '15', '7']);
  });
  it('com a fase em vigor, avisa uma vez por semana; a fase 2 só aparece a 90 dias do início', async () => {
    await avisar('2026-12-16'); await avisar('2026-12-17');           // mesma semana
    await avisar('2026-12-22');                                       // semana seguinte
    const vigor = (await dos(rh, 'conformidade_ec')).filter((n) => n.chave.includes(':vigor:'));
    expect(vigor.map((n) => n.titulo)).toEqual(['EC 141: a fase 1 já está em vigor', 'EC 141: a fase 1 já está em vigor']);
    await avisar('2027-09-20');                                       // 86 dias para a fase 2
    const f2 = (await dos(rh, 'conformidade_ec')).filter((n) => n.chave.includes('EC141_F2'));
    expect(f2).toHaveLength(1);
    expect(f2[0].titulo).toBe('EC 141: faltam 86 dias para a fase 2');
    expect(f2[0].texto).toContain('2 de 3 colaboradores ainda não atendem a jornada e as folgas da fase 2');
  });
  it('depois que a fase 1 termina ela deixa de ser avisada; quem já está adequado não gera aviso', async () => {
    const antes = (await dos(rh, 'conformidade_ec')).filter((n) => n.chave.includes('EC141_F1')).length;
    await avisar('2027-12-20');
    expect((await dos(rh, 'conformidade_ec')).filter((n) => n.chave.includes('EC141_F1')).length).toBe(antes);
    await db.query(`update contrato_versao set jornada_semanal_min = 2400, tipo_escala = '5x2', folgas_semana = 2`);
    const n = (await dos(rh, 'conformidade_ec')).length;
    await avisar('2028-03-01');
    expect((await dos(rh, 'conformidade_ec')).length).toBe(n);
    await db.query(`update contrato_versao set jornada_semanal_min = 2640 where tipo_escala = '5x2' and false`);
  });
});

describe('avisar_conformidade: escala do mês que vem', () => {
  it('a 10 e a 3 dias do mês, sem escala publicada, avisa a gestão (uma vez por marco)', async () => {
    await avisar('2029-05-22');                                       // 10 dias para 1º/06
    await avisar('2029-05-23');                                       // mesmo marco
    await avisar('2029-05-29');                                       // 3 dias
    const e = (await dos(rh, 'escala_pendente')).filter((n) => n.chave.includes('2029-06'));
    expect(e.map((n) => n.chave)).toEqual([`escala_pendente:${emp}:2029-06:10`, `escala_pendente:${emp}:2029-06:3`]);
    expect(e[0]).toMatchObject({ titulo: 'Escala de junho ainda não foi publicada', href: `/empresas/${emp}/escalas` });
    expect(e[0].texto).toContain('O mês começa em 10 dias');
    expect(await dos(colab, 'escala_pendente')).toEqual([]);
  });
  it('fora da janela de 10 dias, ou com escala publicada cobrindo o dia 1º, não avisa', async () => {
    await avisar('2029-08-15');                                       // faltam 17 dias
    expect((await dos(rh, 'escala_pendente')).filter((n) => n.chave.includes('2029-09'))).toEqual([]);
    await db.query(`set session_replication_role = replica`);          // publicada sem passar pela função de publicação (que exige alocações); aqui só importa o status
    await db.query(`insert into escala (organizacao_id, empresa_id, nome, periodo, status, publicada_em, hash_publicado) values ($1,$2,'Out','[2029-10-01,2029-11-01)','publicada', now(), 'h')`, [org, emp]);
    await db.query(`set session_replication_role = origin`);
    await avisar('2029-09-25');
    expect((await dos(rh, 'escala_pendente')).filter((n) => n.chave.includes('2029-10'))).toEqual([]);
    await avisar('2029-10-25');                                       // novembro sem escala: avisa
    expect((await dos(rh, 'escala_pendente')).filter((n) => n.chave.includes('2029-11')).length).toBe(1);
  });
  it('só o worker executa', async () => {
    await expect(comoUsuario(db, rh, (c) => c.query(`select avisar_conformidade('2029-05-22')`))).rejects.toThrow();
  });
});
