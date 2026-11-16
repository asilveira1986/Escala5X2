import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let admA: string, rhB: string, colab: string, lider: string, outroColab: string;
let orgA: string, orgB: string, empA: string, empB: string, setorA: string, c1: string, c2: string, cB: string;

const novoColab = (uid: string, emp: string, nome: string, cpf: string, setor: string | null = null) =>
  comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(
    `select inserir_colaborador($1,$2,$3,'2020-01-01',$4,null,null,null,'superior','11999990000') as id`, [emp, nome, cpf, setor])).rows[0]!.id);

const novaEscala = (uid: string, emp: string, periodo = '[2027-02-01,2027-03-01)') =>
  comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(
    `insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Fevereiro',$2,$3) returning id`, [emp, periodo, uid])).rows[0]!.id);

const turno = (uid: string, esc: string, colabId: string, data: string, ini = 480, fim = 1020, interv = 60) =>
  comoUsuario(db, uid, (c) => c.query(
    `insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',$4,$5,$6)`,
    [esc, colabId, data, ini, fim, interv]));

async function revisao(esc: string) { return (await db.query<{ revisao: number }>(`select revisao from escala where id=$1`, [esc])).rows[0]!.revisao; }

async function publicar(esc: string, ator: string, violacoes: unknown[] = [], rev?: number) {
  const r = rev ?? (await revisao(esc));
  await db.query('begin');
  try {
    await db.query('set local role service_role');
    const x = await db.query<{ h: string }>(`select publicar_escala($1,$2,$3::jsonb,$4,'0.2.0') h`, [esc, r, JSON.stringify(violacoes), ator]);
    await db.query('commit');
    return x.rows[0]!.h;
  } catch (e) { await db.query('rollback'); throw e; }
}

beforeAll(async () => {
  db = await prepararBanco();
  admA = await novoUsuario(db, 'adma'); rhB = await novoUsuario(db, 'rhb');
  colab = await novoUsuario(db, 'colab'); lider = await novoUsuario(db, 'lider'); outroColab = await novoUsuario(db, 'outro');
  const org = (uid: string, n: string) => comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(`select criar_organizacao($1,'empresa') id`, [n])).rows[0]!.id);
  orgA = await org(admA, 'A'); orgB = await org(rhB, 'B');
  const emp = (uid: string, o: string, cnpj: string) => comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(
    `insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E',$2,'medio','3550308','SP') returning id`, [o, cnpj])).rows[0]!.id);
  empA = await emp(admA, orgA, '1'); empB = await emp(rhB, orgB, '2');
  await db.query(`insert into membro values ($1,$2,'colaborador'),($1,$3,'lider'),($1,$4,'colaborador')`, [orgA, colab, lider, outroColab]);
  const u = await comoUsuario(db, admA, async (c) => (await c.query<{ id: string }>(`insert into unidade (empresa_id, nome, municipio_ibge) values ($1,'Matriz','3550308') returning id`, [empA])).rows[0]!.id);
  setorA = await comoUsuario(db, admA, async (c) => (await c.query<{ id: string }>(`insert into setor (unidade_id, nome, lider_usuario_id) values ($1,'Loja',$2) returning id`, [u, lider])).rows[0]!.id);
  c1 = await novoColab(admA, empA, 'Maria', '111.444.777-35', setorA);
  c2 = await novoColab(admA, empA, 'João', '52998224725');
  cB = await novoColab(rhB, empB, 'Zé', '39053344705');
  await db.query(`update colaborador set usuario_id=$1 where id=$2`, [colab, c1]);
  await db.query(`update colaborador set usuario_id=$1 where id=$2`, [outroColab, c2]);
});
afterAll(async () => { await db.end(); });

describe('rascunho', () => {
  it('gestão monta a escala; organização vem da empresa e a revisão sobe a cada mudança', async () => {
    const e = await novaEscala(admA, empA);
    expect((await db.query(`select organizacao_id from escala where id=$1`, [e])).rows[0]!.organizacao_id).toBe(orgA);
    const r0 = await revisao(e);
    await turno(admA, e, c1, '2027-02-01');
    await turno(admA, e, c1, '2027-02-02');
    expect(await revisao(e)).toBe(r0 + 2);
    expect((await db.query(`select distinct organizacao_id from alocacao where escala_id=$1`, [e])).rows).toEqual([{ organizacao_id: orgA }]);
  });
  it('recusa turnos sobrepostos da mesma pessoa, inclusive virando a noite, mas aceita de pessoas diferentes', async () => {
    const e = await novaEscala(admA, empA, '[2027-03-01,2027-04-01)');
    await turno(admA, e, c1, '2027-03-01', 1320, 1800); // 22:00 → 06:00 do dia seguinte
    await expect(turno(admA, e, c1, '2027-03-02', 300, 780)).rejects.toThrow(/exclusion|conflita|violates/i); // 05:00 sobrepõe
    await turno(admA, e, c1, '2027-03-02', 1020, 1320);
    await turno(admA, e, c2, '2027-03-01', 1320, 1800);
  });
  it('recusa colaborador de outra empresa, data fora do período e turno mal formado', async () => {
    const e = await novaEscala(admA, empA, '[2027-04-01,2027-05-01)');
    await expect(turno(admA, e, cB, '2027-04-01')).rejects.toThrow();
    await expect(turno(admA, e, c1, '2027-05-01')).rejects.toThrow(/fora do período/);
    await expect(turno(admA, e, c1, '2027-04-01', 600, 540)).rejects.toThrow();
    await expect(turno(admA, e, c1, '2027-04-01', 480, 540, 60)).rejects.toThrow();
  });
  it('colaborador, líder e outra organização não enxergam nem alteram rascunhos', async () => {
    const e = await novaEscala(admA, empA, '[2027-05-01,2027-06-01)');
    await turno(admA, e, c1, '2027-05-03');
    for (const uid of [colab, lider, rhB]) {
      expect((await comoUsuario(db, uid, (c) => c.query(`select 1 from escala where id=$1`, [e]))).rowCount).toBe(0);
      expect((await comoUsuario(db, uid, (c) => c.query(`select 1 from alocacao where escala_id=$1`, [e]))).rowCount).toBe(0);
    }
    await expect(comoUsuario(db, colab, (c) => c.query(`insert into alocacao (escala_id, colaborador_id, data, tipo) values ($1,$2,'2027-05-04','folga')`, [e, c1]))).rejects.toThrow();
    await expect(comoUsuario(db, rhB, (c) => c.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'x','[2027-01-01,2027-02-01)',$2)`, [empA, rhB]))).rejects.toThrow();
  });
  it('não dá para publicar nem forjar criado_por pelo cliente', async () => {
    const e = await novaEscala(admA, empA, '[2027-06-01,2027-07-01)');
    await turno(admA, e, c1, '2027-06-01');
    await expect(comoUsuario(db, admA, (c) => c.query(`update escala set status='publicada', publicada_em=now(), hash_publicado='x' where id=$1`, [e]))).rejects.toThrow();
    await expect(comoUsuario(db, admA, (c) => c.query(`insert into escala (empresa_id, nome, periodo, status, criado_por, publicada_em, hash_publicado) values ($1,'x','[2028-01-01,2028-02-01)','publicada',$2, now(),'x')`, [empA, admA]))).rejects.toThrow();
    await expect(comoUsuario(db, admA, (c) => c.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'x','[2028-01-01,2028-02-01)',$2)`, [empA, rhB]))).rejects.toThrow();
    await expect(comoUsuario(db, admA, (c) => c.query(`select publicar_escala($1,1,'[]',$2,'x')`, [e, admA]))).rejects.toThrow(/permission denied/);
  });
});

describe('publicação', () => {
  let e: string, hash: string;
  const alertas = [{ codigo: 'COBERTURA_IDEAL', severidade: 'info', mensagem: 'abaixo do ideal', data: '2027-07-05', detalhe: { faltam: 1 } },
                   { codigo: 'TRABALHO_EM_FERIADO', severidade: 'alerta', colaboradorId: '', mensagem: 'feriado' }];
  beforeAll(async () => {
    e = await novaEscala(admA, empA, '[2027-07-01,2027-08-01)');
    await turno(admA, e, c1, '2027-07-05'); await turno(admA, e, c1, '2027-07-06'); await turno(admA, e, c2, '2027-07-05');
  });
  it('recusa bloqueio, revisão desatualizada, quem não gere a empresa e escala vazia', async () => {
    await expect(publicar(e, admA, [{ codigo: 'INTERJORNADA', severidade: 'bloqueio', mensagem: 'x' }])).rejects.toThrow(/bloqueios/);
    await expect(publicar(e, admA, [], 1)).rejects.toThrow(/mudou/);
    await expect(publicar(e, rhB)).rejects.toThrow(/permissão/);
    await expect(publicar(e, colab)).rejects.toThrow(/permissão/);
    const vazia = await novaEscala(admA, empA, '[2027-09-01,2027-10-01)');
    await expect(publicar(vazia, admA)).rejects.toThrow(/sem alocações/i);
  });
  it('publica: carimba hash, ator, versão e guarda as violações restantes; é determinístico', async () => {
    hash = await publicar(e, admA, alertas);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const r = (await db.query(`select status, versao, publicada_por, hash_publicado, motor_versao from escala where id=$1`, [e])).rows[0]!;
    expect(r).toMatchObject({ status: 'publicada', versao: 1, publicada_por: admA, hash_publicado: hash, motor_versao: '0.2.0' });
    expect((await db.query(`select codigo from violacao where escala_id=$1 order by codigo`, [e])).rows.map((x) => x.codigo)).toEqual(['COBERTURA_IDEAL', 'TRABALHO_EM_FERIADO']);
    const aud = await db.query(`select usuario_id from auditoria where tabela='escala' and registro_id=$1 and acao='publicar'`, [e]);
    expect(aud.rows).toEqual([{ usuario_id: admA }]);
    await expect(publicar(e, admA)).rejects.toThrow(/rascunho/);
  });
  it('depois de publicada é imutável, mesmo para o gestor', async () => {
    await expect(turno(admA, e, c2, '2027-07-07')).rejects.toThrow(/imutável/);
    await expect(comoUsuario(db, admA, (c) => c.query(`update alocacao set fim_min = 1100 where escala_id=$1`, [e]))).rejects.toThrow();
    await expect(comoUsuario(db, admA, (c) => c.query(`delete from alocacao where escala_id=$1`, [e]))).rejects.toThrow();
    // a RLS esconde a escala publicada de update/delete: nenhuma linha é afetada
    expect((await comoUsuario(db, admA, (c) => c.query(`update escala set nome='y' where id=$1`, [e]))).rowCount).toBe(0);
    expect((await comoUsuario(db, admA, (c) => c.query(`delete from escala where id=$1`, [e]))).rowCount).toBe(0);
    await expect(db.query(`update escala set nome='y' where id=$1`, [e])).rejects.toThrow(/imutável/);        // nem o dono do banco
    await expect(db.query(`update violacao set mensagem='y' where escala_id=$1`, [e])).rejects.toThrow(/histórico/);
    await expect(db.query(`delete from alocacao where escala_id=$1`, [e])).rejects.toThrow(/imutável/);
  });
  it('colaborador vê só a própria escala; líder, a do setor; outro colaborador e outra org, nada', async () => {
    const ver = (uid: string) => comoUsuario(db, uid, (c) => c.query<{ colaborador_id: string }>(`select colaborador_id from alocacao where escala_id=$1`, [e]));
    expect([...new Set((await ver(colab)).rows.map((x) => x.colaborador_id))]).toEqual([c1]);
    expect([...new Set((await ver(outroColab)).rows.map((x) => x.colaborador_id))]).toEqual([c2]);
    expect([...new Set((await ver(lider)).rows.map((x) => x.colaborador_id))]).toEqual([c1]); // setor da Maria
    expect((await ver(rhB)).rowCount).toBe(0);
    expect((await comoUsuario(db, colab, (c) => c.query(`select 1 from escala where id=$1`, [e]))).rowCount).toBe(1);
    expect((await comoUsuario(db, colab, (c) => c.query(`select 1 from violacao where escala_id=$1`, [e]))).rowCount).toBe(0);
  });
  it('ciência: o colaborador confirma uma vez, com o hash; não dá para forjar nem alterar', async () => {
    await comoUsuario(db, colab, (c) => c.query(`select registrar_ciencia($1)`, [e]));
    await comoUsuario(db, colab, (c) => c.query(`select registrar_ciencia($1)`, [e])); // idempotente
    const r = await db.query(`select colaborador_id, usuario_id, hash_escala from ciencia where escala_id=$1`, [e]);
    expect(r.rows).toEqual([{ colaborador_id: c1, usuario_id: colab, hash_escala: hash }]);
    await expect(comoUsuario(db, lider, (c) => c.query(`select registrar_ciencia($1)`, [e]))).rejects.toThrow(/não está nesta escala/);
    await expect(comoUsuario(db, rhB, (c) => c.query(`select registrar_ciencia($1)`, [e]))).rejects.toThrow();
    await expect(comoUsuario(db, colab, (c) => c.query(`insert into ciencia (escala_id, colaborador_id, usuario_id, hash_escala) values ($1,$2,$3,'x')`, [e, c2, colab]))).rejects.toThrow();
    await expect(db.query(`update ciencia set hash_escala='z'`)).rejects.toThrow(/histórico/);
    expect((await comoUsuario(db, admA, (c) => c.query(`select 1 from ciencia where escala_id=$1`, [e]))).rowCount).toBe(1);
    expect((await comoUsuario(db, outroColab, (c) => c.query(`select 1 from ciencia where escala_id=$1`, [e]))).rowCount).toBe(0);
  });
  it('rascunho só chega a ciente depois de publicado', async () => {
    const r = await novaEscala(admA, empA, '[2027-10-01,2027-11-01)');
    await turno(admA, r, c1, '2027-10-04');
    await expect(comoUsuario(db, colab, (c) => c.query(`select registrar_ciencia($1)`, [r]))).rejects.toThrow(/não está publicada/);
  });
  it('nova versão do mesmo período substitui a anterior e preserva o histórico; períodos que se sobrepõem de verdade não coexistem', async () => {
    const n = await novaEscala(admA, empA, '[2027-07-01,2027-08-01)');
    await turno(admA, n, c1, '2027-07-05', 540, 1080);
    await publicar(n, admA);
    const r = await db.query(`select id, status, versao from escala where empresa_id=$1 and periodo='[2027-07-01,2027-08-01)' order by criado_em`, [empA]);
    expect(r.rows.map((x) => [x.status, x.versao])).toEqual([['substituida', 1], ['publicada', 2]]);
    expect((await db.query(`select count(*)::int n from alocacao where escala_id=$1`, [e])).rows[0]!.n).toBe(3); // histórico intacto
    expect((await comoUsuario(db, colab, (c) => c.query(`select 1 from alocacao where escala_id=$1`, [e]))).rowCount).toBe(0); // versão antiga some
  });
});

describe('cadastros de apoio e isolamento', () => {
  it('turnos-modelo, demanda e ausências: gestão escreve; colaborador lê turnos, não demanda; outra org nada', async () => {
    await comoUsuario(db, admA, async (c) => {
      await c.query(`insert into turno_modelo (empresa_id, nome, inicio_min, fim_min, intervalo_min) values ($1,'Manhã',480,1020,60)`, [empA]);
      await c.query(`insert into demanda_cobertura (empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal) values ($1,$2,1,480,720,2,3)`, [empA, setorA]);
      await c.query(`insert into ausencia (empresa_id, colaborador_id, periodo, tipo) values ($1,$2,'[2027-08-02,2027-08-17)','ferias')`, [empA, c1]);
    });
    expect((await comoUsuario(db, colab, (c) => c.query(`select 1 from turno_modelo`))).rowCount).toBe(1);
    expect((await comoUsuario(db, colab, (c) => c.query(`select 1 from demanda_cobertura`))).rowCount).toBe(0);
    expect((await comoUsuario(db, colab, (c) => c.query(`select 1 from ausencia`))).rowCount).toBe(1);
    expect((await comoUsuario(db, outroColab, (c) => c.query(`select 1 from ausencia`))).rowCount).toBe(0);
    for (const t of ['turno_modelo', 'demanda_cobertura', 'ausencia', 'escala']) {
      expect((await comoUsuario(db, rhB, (c) => c.query(`select 1 from ${t}`))).rowCount, t).toBe(0);
    }
    await expect(comoUsuario(db, colab, (c) => c.query(`insert into turno_modelo (empresa_id, nome, inicio_min, fim_min) values ($1,'x',0,60)`, [empA]))).rejects.toThrow();
  });
  it('férias não se sobrepõem para a mesma pessoa; turno-modelo e ausência exigem dados coerentes', async () => {
    await expect(comoUsuario(db, admA, (c) => c.query(`insert into ausencia (empresa_id, colaborador_id, periodo, tipo) values ($1,$2,'[2027-08-10,2027-08-20)','afastamento')`, [empA, c1]))).rejects.toThrow();
    await expect(comoUsuario(db, admA, (c) => c.query(`insert into ausencia (empresa_id, colaborador_id, periodo, tipo) values ($1,$2,'[2027-09-01,2027-09-05)','ferias')`, [empA, cB]))).rejects.toThrow(/não pertence/);
    await expect(comoUsuario(db, admA, (c) => c.query(`insert into turno_modelo (empresa_id, nome, inicio_min, fim_min, intervalo_min) values ($1,'Ruim',480,540,60)`, [empA]))).rejects.toThrow();
  });
  it('mudanças ficam na trilha de auditoria da organização', async () => {
    const r = await db.query(`select distinct tabela from auditoria where organizacao_id=$1 and tabela in ('escala','alocacao','turno_modelo','ausencia','ciencia','violacao')`, [orgA]);
    expect(r.rows.map((x) => x.tabela).sort()).toEqual(['alocacao', 'ausencia', 'ciencia', 'escala', 'turno_modelo', 'violacao']);
  });
});

describe('demanda de cobertura: coerência', () => {
  it('recusa setor de outra empresa e faixa sem duração; aceita faixa que cruza a meia-noite', async () => {
    const outraEmp = empB;
    const un = (await db.query(`insert into unidade (empresa_id, nome, municipio_ibge) values ($1,'Outra','3550308') returning id`, [outraEmp])).rows[0].id;
    const setorOutra = (await db.query(`insert into setor (unidade_id, nome) values ($1,'S','x') returning id`.replace(",'x'", ''), [un])).rows[0].id;
    const ins = (setorId: string | null, ini: number, fim: number) => comoUsuario(db, admA, (c) => c.query(
      `insert into demanda_cobertura (empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo) values ($1,$2,2,$3,$4,1)`, [empA, setorId, ini, fim]));
    await expect(ins(setorOutra, 480, 720)).rejects.toThrow(/setor não pertence/);
    await expect(ins(null, 480, 480)).rejects.toThrow(/duração zero/);
    await ins(setorA, 1320, 360); // 22:00 → 06:00
    await ins(null, 480, 1440);   // até o fim do dia
  });
});
