import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let rh: string, ua: string, ub: string, uc: string, uOutro: string, uForaEscala: string, uOrgB: string;
let org: string, emp: string, A: string, B: string, C: string, F: string, esc: string, rasc: string;
let hoje: string;
const dia = (n: number) => new Date(Date.parse(`${hoje}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const criar = (uid: string, colab: string, tipo: string, payload: unknown, dest: string | null = null, motivo: string | null = null) =>
  comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(`select criar_solicitacao($1,$2,$3::jsonb,$4,$5) id`, [colab, tipo, JSON.stringify(payload), dest, motivo])).rows[0]!.id);
const chamar = (uid: string, sql: string, params: unknown[]) => comoUsuario(db, uid, (c) => c.query(sql, params));
const estado = async (id: string) => (await db.query(`select status, decisao_motivo, decidido_por, validacao from solicitacao where id=$1`, [id])).rows[0];
const trocaTurno = (a = 12, b = 13) => ({ escalaId: esc, dataSolicitante: dia(a), dataColega: dia(b) });

beforeAll(async () => {
  db = await prepararBanco();
  hoje = (await db.query<{ h: string }>(`select hoje_sp()::text h`)).rows[0]!.h;
  rh = await novoUsuario(db, 'rh'); ua = await novoUsuario(db, 'ua'); ub = await novoUsuario(db, 'ub'); uc = await novoUsuario(db, 'uc');
  uOutro = await novoUsuario(db, 'outro'); uForaEscala = await novoUsuario(db, 'fora'); uOrgB = await novoUsuario(db, 'orgb');
  org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
  await comoUsuario(db, uOrgB, (c) => c.query(`select criar_organizacao('B','empresa')`));
  for (const u of [ua, ub, uc, uOutro, uForaEscala]) await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, u]);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  const mk = async (n: string, cpf: string, usuario: string | null) => (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao, usuario_id) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01',$4) returning id`, [emp, n, cpf, usuario])).rows[0].id as string;
  A = await mk('Ana', '1', ua); B = await mk('Bia', '2', ub); C = await mk('Caio', '3', null); F = await mk('Fora', '4', uForaEscala);
  await mk('Outro', '5', uOutro);
  esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Pub',daterange($2::date,$3::date),$4) returning id`, [emp, dia(10), dia(40), rh])).rows[0].id;
  const trab = (c: string, d: number) => db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',480,1020,60)`, [esc, c, dia(d)]);
  await trab(A, 12); await trab(A, 14); await trab(A, 11); await trab(B, 13); await trab(B, 15); await trab(C, 13);
  await db.query('begin'); await db.query(`select set_config('app.publicando','1',true)`);
  await db.query(`update escala set status='publicada', publicada_em=now(), hash_publicado='h' where id=$1`, [esc]); await db.query('commit');
  rasc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Rasc',daterange($2::date,$3::date),$4) returning id`, [emp, dia(50), dia(70), rh])).rows[0].id;
});
afterAll(async () => { await db.end(); });

describe('criar_solicitacao: troca de turno', () => {
  it('cria aguardando o colega, com nomes gravados e auditoria', async () => {
    const id = await criar(ua, A, 'troca_turno', trocaTurno(12, 13), B, 'Consulta médica');
    const r = (await db.query(`select * from solicitacao where id=$1`, [id])).rows[0];
    expect(r).toMatchObject({ status: 'aguardando_colega', solicitante_nome: 'Ana', destinatario_nome: 'Bia', empresa_id: emp, organizacao_id: org, motivo: 'Consulta médica', canal: 'web' });
    expect((await db.query(`select 1 from auditoria where tabela='solicitacao' and registro_id=$1 and acao='criar'`, [id])).rowCount).toBe(1);
    await expect(criar(ua, A, 'troca_turno', trocaTurno(12, 13), B)).rejects.toThrow(/já fez esse pedido/);
    await chamar(ua, `select cancelar_solicitacao($1)`, [id]);
  });
  it('recusa: data passada, sem turno, colega sem turno, colega sem acesso, a si mesmo, de outra empresa, escala em rascunho', async () => {
    await expect(criar(ua, A, 'troca_turno', { escalaId: esc, dataSolicitante: dia(-1), dataColega: dia(13) }, B)).rejects.toThrow(/de hoje em diante/);
    await expect(criar(ua, A, 'troca_turno', trocaTurno(20, 13), B)).rejects.toThrow(/Você não tem turno/);
    await expect(criar(ua, A, 'troca_turno', trocaTurno(12, 20), B)).rejects.toThrow(/colega não tem turno/);
    await expect(criar(ua, A, 'troca_turno', trocaTurno(12, 13), C)).rejects.toThrow(/ainda não tem acesso/);
    await expect(criar(ua, A, 'troca_turno', trocaTurno(12, 14), A)).rejects.toThrow(/colega da sua empresa/);
    await expect(criar(ua, A, 'troca_turno', { escalaId: rasc, dataSolicitante: dia(60), dataColega: dia(61) }, B)).rejects.toThrow(/não está publicada/);
    await expect(criar(ua, A, 'troca_turno', trocaTurno(12, 13), null)).rejects.toThrow();
  });
  it('só o próprio colaborador pede por si', async () => {
    await expect(criar(ub, A, 'troca_turno', trocaTurno(12, 13), B)).rejects.toThrow(/sem permissão/);
    await expect(criar(rh, A, 'troca_turno', trocaTurno(12, 13), B)).rejects.toThrow(/sem permissão/);
    await expect(criar(uOrgB, A, 'ferias', { inicio: dia(20), fim: dia(25) })).rejects.toThrow(/sem permissão/);
  });
});

describe('fluxo do colega e cancelamento', () => {
  it('o colega aceita → pendente de decisão do RH; só ele responde, uma vez', async () => {
    const id = await criar(ua, A, 'troca_turno', trocaTurno(14, 15), B);
    await expect(chamar(ua, `select responder_solicitacao($1,true)`, [id])).rejects.toThrow(/sem permissão/);
    await expect(chamar(uc, `select responder_solicitacao($1,true)`, [id])).rejects.toThrow(/sem permissão/);
    await chamar(ub, `select responder_solicitacao($1,true)`, [id]);
    expect((await estado(id)).status).toBe('pendente');
    await expect(chamar(ub, `select responder_solicitacao($1,false)`, [id])).rejects.toThrow(/não está mais aguardando/);
    await chamar(ua, `select cancelar_solicitacao($1)`, [id]);
  });
  it('o colega recusa → recusada com o motivo padrão; cancelar depois não é possível', async () => {
    const id = await criar(ua, A, 'troca_turno', trocaTurno(12, 15), B);
    await chamar(ub, `select responder_solicitacao($1,false)`, [id]);
    expect(await estado(id)).toMatchObject({ status: 'recusada', decisao_motivo: 'Recusada pelo colega.' });
    await expect(chamar(ua, `select cancelar_solicitacao($1)`, [id])).rejects.toThrow(/já foi encerrado/);
  });
  it('cancelar: só o solicitante, só enquanto aberta', async () => {
    const id = await criar(ua, A, 'ferias', { inicio: dia(100), fim: dia(110) });
    await expect(chamar(ub, `select cancelar_solicitacao($1)`, [id])).rejects.toThrow(/sem permissão/);
    await expect(chamar(rh, `select cancelar_solicitacao($1)`, [id])).rejects.toThrow(/sem permissão/);
    await chamar(ua, `select cancelar_solicitacao($1)`, [id]);
    expect((await estado(id)).status).toBe('cancelada');
    await expect(chamar(ua, `select cancelar_solicitacao($1)`, [id])).rejects.toThrow(/já foi encerrado/);
  });
});

describe('troca de folga, férias e afastamento', () => {
  it('troca de folga: valida os dois dias e o período', async () => {
    const ok = await criar(ua, A, 'troca_folga', { escalaId: esc, trabalharEm: dia(13), folgarEm: dia(14) });
    expect((await estado(ok)).status).toBe('pendente');
    await expect(criar(ua, A, 'troca_folga', { escalaId: esc, trabalharEm: dia(14), folgarEm: dia(14) })).rejects.toThrow(/dois dias diferentes/);
    await expect(criar(ua, A, 'troca_folga', { escalaId: esc, trabalharEm: dia(20), folgarEm: dia(30) })).rejects.toThrow(/Você não tem turno/);
    await expect(criar(ua, A, 'troca_folga', { escalaId: esc, trabalharEm: dia(11), folgarEm: dia(12) })).rejects.toThrow(/Você já trabalha/);
    await expect(criar(ua, A, 'troca_folga', { escalaId: esc, trabalharEm: dia(100), folgarEm: dia(14) })).rejects.toThrow(/dentro do período/);
    await expect(criar(ua, A, 'troca_folga', { escalaId: esc, trabalharEm: dia(13), folgarEm: dia(14) }, B)).rejects.toThrow(/já fez esse pedido|constraint|check/);
    await chamar(ua, `select cancelar_solicitacao($1)`, [ok]);
  });
  it('férias: de hoje em diante, até 45 dias, sem sobrepor ausência já lançada', async () => {
    await expect(criar(ub, B, 'ferias', { inicio: dia(-2), fim: dia(5) })).rejects.toThrow(/de hoje em diante/);
    await expect(criar(ub, B, 'ferias', { inicio: dia(10), fim: dia(5) })).rejects.toThrow(/primeiro e o último dia/);
    await expect(criar(ub, B, 'ferias', { inicio: dia(10), fim: dia(60) })).rejects.toThrow(/longo demais/);
    await db.query(`insert into ausencia (empresa_id, colaborador_id, periodo, tipo) values ($1,$2,daterange($3::date,$4::date),'ferias')`, [emp, B, dia(200), dia(210)]);
    await expect(criar(ub, B, 'ferias', { inicio: dia(205), fim: dia(215) })).rejects.toThrow(/já tem férias ou afastamento/);
    const id = await criar(ub, B, 'ferias', { inicio: dia(300), fim: dia(314) }, null, '  Viagem  ');
    expect((await db.query(`select status, motivo, destinatario_id from solicitacao where id=$1`, [id])).rows[0]).toEqual({ status: 'pendente', motivo: 'Viagem', destinatario_id: null });
    await expect(criar(ub, B, 'ferias', { inicio: dia(300), fim: dia(314) }, A)).rejects.toThrow();
  });
  it('afastamento (atestado) pode ser informado até 30 dias depois do início', async () => {
    const id = await criar(uc, C, 'afastamento', { inicio: dia(-5), fim: dia(-3) }).catch((e) => e);
    expect(String(id)).toMatch(/sem permissão/);                       // Caio não tem acesso ao app: quem não tem usuário não pede
    const ok = await criar(ua, A, 'afastamento', { inicio: dia(-5), fim: dia(-3) }, null, 'Atestado de 3 dias');
    expect((await estado(ok)).status).toBe('pendente');
    await expect(criar(ua, A, 'afastamento', { inicio: dia(-40), fim: dia(-38) })).rejects.toThrow(/até 30 dias/);
  });
  it('tipo desconhecido e payload inválido', async () => {
    await expect(criar(ua, A, 'ajuste_ponto', { x: 1 })).rejects.toThrow(/tipo de pedido inválido/);
    await expect(criar(ua, A, 'ferias', [1, 2] as never)).rejects.toThrow(/pedido inválido/);
  });
  it('no máximo 10 pedidos em aberto por pessoa', async () => {
    const outro = (await db.query(`select id from colaborador where nome='Outro'`)).rows[0].id as string;
    for (let i = 0; i < 10; i++) await criar(uOutro, outro, 'ferias', { inicio: dia(400 + i * 50), fim: dia(405 + i * 50) });
    await expect(criar(uOutro, outro, 'ferias', { inicio: dia(1000), fim: dia(1005) })).rejects.toThrow(/10 pedidos em aberto/);
  });
});

describe('decidir_solicitacao (RH)', () => {
  it('aprova guardando a validação do motor; só o RH, só pendente', async () => {
    const id = await criar(ub, B, 'ferias', { inicio: dia(500), fim: dia(510) });
    await expect(chamar(ub, `select decidir_solicitacao($1,true,null,null)`, [id])).rejects.toThrow(/sem permissão/);
    await expect(chamar(uOrgB, `select decidir_solicitacao($1,true,null,null)`, [id])).rejects.toThrow(/sem permissão/);
    await chamar(rh, `select decidir_solicitacao($1,true,null,$2::jsonb)`, [id, JSON.stringify({ bloqueios: 0, alertas: 1 })]);
    expect(await estado(id)).toMatchObject({ status: 'aprovada', decidido_por: rh, validacao: { bloqueios: 0, alertas: 1 } });
    await expect(chamar(rh, `select decidir_solicitacao($1,false,'tarde demais',null)`, [id])).rejects.toThrow(/não está pendente/);
  });
  it('recusar exige motivo; pedido ainda aguardando o colega não pode ser decidido', async () => {
    const id = await criar(ub, B, 'ferias', { inicio: dia(600), fim: dia(605) });
    await expect(chamar(rh, `select decidir_solicitacao($1,false,' ',null)`, [id])).rejects.toThrow(/motivo da recusa/);
    await chamar(rh, `select decidir_solicitacao($1,false,'Período de pico',null)`, [id]);
    expect(await estado(id)).toMatchObject({ status: 'recusada', decisao_motivo: 'Período de pico' });
    const t = await criar(ua, A, 'troca_turno', trocaTurno(14, 13), B);
    await expect(chamar(rh, `select decidir_solicitacao($1,true,null,null)`, [t])).rejects.toThrow(/não está pendente/);
    await chamar(ua, `select cancelar_solicitacao($1)`, [t]);
  });
  it('as decisões ficam na auditoria', async () => {
    const r = await db.query(`select array_agg(distinct acao order by acao) a from auditoria where tabela='solicitacao' and acao in ('aprovar','recusar','colega_aceitou','colega_recusou','cancelar','criar')`);
    expect(r.rows[0].a).toEqual(['aprovar', 'cancelar', 'colega_aceitou', 'colega_recusou', 'criar', 'recusar']);
  });
});

describe('visibilidade (RLS) e escala_colegas', () => {
  it('solicitante, colega e RH enxergam o pedido; os demais, não; ninguém escreve direto', async () => {
    const id = await criar(ua, A, 'troca_turno', trocaTurno(11, 15), B);
    const vê = async (u: string) => (await comoUsuario(db, u, (c) => c.query(`select 1 from solicitacao where id=$1`, [id]))).rowCount;
    expect(await vê(ua)).toBe(1); expect(await vê(ub)).toBe(1); expect(await vê(rh)).toBe(1);
    expect(await vê(uc)).toBe(0); expect(await vê(uOutro)).toBe(0); expect(await vê(uOrgB)).toBe(0);
    await expect(chamar(ua, `update solicitacao set status='aprovada' where id=$1`, [id])).rejects.toThrow();
    await expect(chamar(ua, `insert into solicitacao (organizacao_id, empresa_id, solicitante_id, solicitante_nome, tipo, payload) values ($1,$2,$3,'x','ferias','{}')`, [org, emp, A])).rejects.toThrow();
    await chamar(ua, `select cancelar_solicitacao($1)`, [id]);
  });
  it('escala_colegas: quem está na escala vê os colegas com acesso e seus turnos futuros; fora da escala, nada', async () => {
    const r = await comoUsuario(db, ua, (c) => c.query(`select nome, data::text from escala_colegas($1)`, [esc]));
    const nomes = new Set(r.rows.map((x) => x.nome));
    expect(nomes.has('Bia')).toBe(true);
    expect(nomes.has('Caio')).toBe(false);                               // sem acesso ao app: não aparece
    expect(nomes.has('Fora')).toBe(false);                               // não trabalha nessa escala
    expect((await comoUsuario(db, uForaEscala, (c) => c.query(`select 1 from escala_colegas($1)`, [esc]))).rowCount).toBe(0);
    expect((await comoUsuario(db, uOrgB, (c) => c.query(`select 1 from escala_colegas($1)`, [esc]))).rowCount).toBe(0);
    expect((await comoUsuario(db, ua, (c) => c.query(`select 1 from escala_colegas($1)`, [rasc]))).rowCount).toBe(0);   // rascunho: nada
  });
  it('escala_colegas não mostra turnos passados', async () => {
    const p = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Passada',daterange($2::date,$3::date),$4) returning id`, [emp, dia(-20), dia(-5), rh])).rows[0].id;
    for (const c of [A, B]) await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',480,1020,60)`, [p, c, dia(-10)]);
    await db.query('begin'); await db.query(`select set_config('app.publicando','1',true)`);
    await db.query(`update escala set status='publicada', publicada_em=now(), hash_publicado='h' where id=$1`, [p]); await db.query('commit');
    expect((await comoUsuario(db, ua, (c) => c.query(`select 1 from escala_colegas($1)`, [p]))).rowCount).toBe(0);
  });

  it('férias aprovadas lançam a ausência na mesma transação; sobreposição desfaz tudo', async () => {
    const id = await criar(ub, B, 'ferias', { inicio: dia(700), fim: dia(709) });
    await chamar(rh, `select decidir_solicitacao($1,true,null,null)`, [id]);
    const aus = await db.query(`select lower(periodo)::text i, (upper(periodo) - 1)::text f, tipo from ausencia where colaborador_id=$1 and lower(periodo)=$2`, [B, dia(700)]);
    expect(aus.rows).toEqual([{ i: dia(700), f: dia(709), tipo: 'ferias' }]);
    const id2 = await criar(ub, B, 'afastamento', { inicio: dia(720), fim: dia(722) });
    await db.query(`insert into ausencia (empresa_id, colaborador_id, periodo, tipo) values ($1,$2,daterange($3::date,$4::date),'ferias')`, [emp, B, dia(721), dia(725)]);   // RH lançou algo no meio do caminho
    await expect(chamar(rh, `select decidir_solicitacao($1,true,null,null)`, [id2])).rejects.toThrow();
    expect((await estado(id2)).status).toBe('pendente');                       // nada mudou
  });
});

describe('versões da escala', () => {
  it('escala_vigente aponta para a versão publicada do mesmo período', async () => {
    const r = await comoUsuario(db, rh, (c) => c.query(`select escala_vigente($1) v`, [esc]));
    expect(r.rows[0].v).toBe(esc);
    expect((await comoUsuario(db, uOrgB, (c) => c.query(`select escala_vigente($1) v`, [esc]))).rows[0].v).toBeNull();
  });
  it('criar_versao_rascunho copia as alocações; só gestão; só a partir de publicada; descartar remove o rascunho', async () => {
    const novo = (await comoUsuario(db, rh, (c) => c.query(`select criar_versao_rascunho($1) v`, [esc]))).rows[0].v as string;
    const n = (await db.query(`select (select count(*)::int from alocacao where escala_id=$1) a, (select count(*)::int from alocacao where escala_id=$2) b, (select status from escala where id=$2) s`, [esc, novo])).rows[0];
    expect(n.a).toBe(n.b); expect(n.s).toBe('rascunho');
    await expect(comoUsuario(db, ua, (c) => c.query(`select criar_versao_rascunho($1)`, [esc]))).rejects.toThrow(/não encontrada|permissão|row-level security/);
    await expect(comoUsuario(db, rh, (c) => c.query(`select criar_versao_rascunho($1)`, [novo]))).rejects.toThrow(/Só uma escala publicada/);
    await comoUsuario(db, rh, (c) => c.query(`select descartar_versao_rascunho($1)`, [novo]));
    expect((await db.query(`select 1 from escala where id=$1`, [novo])).rowCount).toBe(0);
    await comoUsuario(db, rh, (c) => c.query(`select descartar_versao_rascunho($1)`, [esc]));       // publicada: não apaga
    expect((await db.query(`select 1 from escala where id=$1`, [esc])).rowCount).toBe(1);
  });
});
