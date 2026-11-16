import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { comoUsuario, novoUsuario, prepararBanco } from './helpers';

let db: Client;
let contador: string, rhA: string, rhX: string, colab: string;
let orgContab: string, orgA: string, orgX: string, empA: string, empB: string, empX: string;
let c1: string, c2: string, c3: string;

type Linha = Record<string, unknown> & { razao_social: string };
const painel = (uid: string, mes = '2027-03-10') => comoUsuario(db, uid, async (c) => (await c.query<Linha>(`select p.*, p.diagnostico_em::text as diag_txt from painel_carteira($1) p`, [mes])).rows);
const mkEmp = async (org: string, nome: string, cnpj: string) => (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,$2,$3,'medio','3550308','SP') returning id`, [org, nome, cnpj])).rows[0].id as string;
const mkColab = async (emp: string, nome: string, cpf: string, contrato = true) => {
  const id = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01') returning id`, [emp, nome, cpf])).rows[0].id as string;
  if (contrato) await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1,'[2020-01-01,)',3000,2400,200,'5x2')`, [id]);
  return id;
};

beforeAll(async () => {
  db = await prepararBanco();
  contador = await novoUsuario(db, 'contador'); rhA = await novoUsuario(db, 'rha'); rhX = await novoUsuario(db, 'rhx'); colab = await novoUsuario(db, 'colab');
  const org = (uid: string, n: string, t: string) => comoUsuario(db, uid, async (c) => (await c.query<{ id: string }>(`select criar_organizacao($1,$2::tipo_org) id`, [n, t])).rows[0]!.id);
  orgContab = await org(contador, 'Contab', 'contabilidade'); orgA = await org(rhA, 'Cliente A', 'empresa'); orgX = await org(rhX, 'Estranha', 'empresa');
  empA = await mkEmp(orgA, 'Alfa Ltda', '1'); empB = await mkEmp(orgContab, 'Beta Ltda', '2'); empX = await mkEmp(orgX, 'Xis Ltda', '3');
  await db.query(`insert into vinculo_empresa values ($1,$2,'gestao')`, [empA, orgContab]);
  // Alfa: 3 com contrato + 1 sem; diagnóstico; escala publicada do mês com 3 pessoas (2 com acesso, 1 sem); 1 ciência dada
  c1 = await mkColab(empA, 'Ana', '1'); c2 = await mkColab(empA, 'Bia', '2'); c3 = await mkColab(empA, 'Caio', '3'); await mkColab(empA, 'Sem contrato', '4', false);
  await db.query(`update colaborador set usuario_id=$1 where id=$2`, [colab, c1]);
  const u2 = await novoUsuario(db, 'bia'); await db.query(`insert into membro values ($1,$2,'colaborador')`, [orgA, u2]); await db.query(`update colaborador set usuario_id=$1 where id=$2`, [u2, c2]);
  await db.query(`insert into diagnostico (empresa_id, data_referencia, resumo) values ($1,'2027-02-01', $2::jsonb)`, [empA, JSON.stringify({ resumo: { total: 40, porClassificacao: { adequado: 25, adequacao_f1: 10, adequacao_f2: 3, excecao: 2 } } })]);
  const esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Mar','[2027-03-01,2027-04-01)',$2) returning id`, [empA, rhA])).rows[0].id;
  for (const c of [c1, c2, c3]) await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,'2027-03-01','trabalho',480,1020,60)`, [esc, c]);
  await db.query('begin'); await db.query(`select set_config('app.publicando','1',true)`);
  await db.query(`update escala set status='publicada', publicada_em=now(), hash_publicado='h' where id=$1`, [esc]); await db.query('commit');
  await comoUsuario(db, colab, (c) => c.query(`select registrar_ciencia($1)`, [esc]));
  // Beta: sem nada, com escala em rascunho em outro mês e importação com erro
  await mkColab(empB, 'Zé', '9');
  await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Abr','[2027-04-01,2027-05-01)',$2)`, [empB, contador]);
  await db.query(`insert into importacao (organizacao_id, empresa_id, tipo, arquivo_path, status, criado_por) values ($1,$2,'colaboradores',$3,'erro',$4)`, [orgContab, empB, `${orgContab}/x.xlsx`, contador]);
});
afterAll(async () => { await db.end(); });

describe('painel_carteira', () => {
  it('o escritório vê suas empresas e as vinculadas, e nenhuma de fora', async () => {
    const r = await painel(contador);
    expect(r.map((x) => x.razao_social)).toEqual(['Alfa Ltda', 'Beta Ltda']);
  });
  it('conta colaboradores com contrato, sem contrato e o resumo do último diagnóstico', async () => {
    const a = (await painel(contador)).find((x) => x.razao_social === 'Alfa Ltda')!;
    expect(a).toMatchObject({ colaboradores: 3, sem_contrato: 1, diagnostico_total: 40, diagnostico_a_adequar: 13, organizacao_nome: null }); // o escritório não enxerga a organização do cliente
    expect(a.diag_txt).toBe('2027-02-01');
  });
  it('escalas do mês: publicadas, ciências pendentes (só quem tem acesso) e quem ainda está sem acesso', async () => {
    const a = (await painel(contador)).find((x) => x.razao_social === 'Alfa Ltda')!;
    expect(a).toMatchObject({ escalas_publicadas: 1, escalas_rascunho: 0, ciencias_pendentes: 1, sem_acesso: 1 }); // Bia pendente; Caio sem acesso; Ana ciente
  });
  it('escala de outro mês não conta; rascunho conta no mês dele; importação com erro aparece', async () => {
    const mar = (await painel(contador, '2027-03-15')).find((x) => x.razao_social === 'Beta Ltda')!;
    expect(mar).toMatchObject({ escalas_publicadas: 0, escalas_rascunho: 0, diagnostico_id: null, diagnostico_total: null, importacao_erro: true });
    const abr = (await painel(contador, '2027-04-30')).find((x) => x.razao_social === 'Beta Ltda')!;
    expect(abr).toMatchObject({ escalas_rascunho: 1 });
    const fev = (await painel(contador, '2027-02-28')).find((x) => x.razao_social === 'Alfa Ltda')!;
    expect(fev).toMatchObject({ escalas_publicadas: 0, ciencias_pendentes: 0 });
  });
  it('cada organização enxerga só o que o RLS permite', async () => {
    expect((await painel(rhA)).map((x) => x.razao_social)).toEqual(['Alfa Ltda']);
    expect((await painel(rhX)).map((x) => x.razao_social)).toEqual(['Xis Ltda']);
  });
  it('colaborador não vê números de gestão (contagens limitadas pelo RLS)', async () => {
    const r = await painel(colab);
    for (const l of r) expect(l.escalas_rascunho).toBe(0); // rascunhos nunca aparecem para quem trabalha na empresa
  });
});
