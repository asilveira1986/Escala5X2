import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, novoUsuario, prepararBanco } from '../../db/test/helpers';
import { carregarDiagnostico, executarDiagnostico, simularESalvar, ErroServico } from '../src';
import { PARAMETROS_PADRAO } from '@jc/rules-engine';
import { rpcPg } from './pg-rpc';

let db: Client;
let rh: string, rhB: string, contador: string, advogado: string;
let orgA: string, orgB: string, orgContab: string, orgJur: string, emp: string;

const orgDe = (u: string, nome: string, tipo: string) => comoUsuario(db, u, async (c) =>
  (await c.query<{ id: string }>(`select criar_organizacao($1,$2::tipo_org) id`, [nome, tipo])).rows[0]!.id);

beforeAll(async () => {
  db = await prepararBanco();
  rh = await novoUsuario(db, 'rh'); rhB = await novoUsuario(db, 'rhb'); contador = await novoUsuario(db, 'contador'); advogado = await novoUsuario(db, 'adv');
  orgA = await orgDe(rh, 'Varejo', 'empresa'); orgB = await orgDe(rhB, 'Outra', 'empresa');
  orgContab = await orgDe(contador, 'Contab', 'contabilidade'); orgJur = await orgDe(advogado, 'Jurídico', 'juridico');
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'Loja','1','medio','3550308','SP') returning id`, [orgA])).rows[0].id;
  const un = (await db.query(`insert into unidade (empresa_id, nome, municipio_ibge) values ($1,'Matriz','3550308') returning id`, [emp])).rows[0].id;
  await db.query(`insert into setor (unidade_id, nome) select $1, n from unnest(array['Loja','Estoque','Caixa','Entrega']) n`, [un]);
  // 200 colaboradores: 6x1/44h (140), 5x2/40h (40), alta renda 5x2/44h (10), 12x36/42h (10)
  await db.query(`
    insert into colaborador (empresa_id, setor_id, nome, cpf_cifrado, cpf_hash, admissao, escolaridade)
    select $1, (select id from setor order by nome offset (g % 4) limit 1), 'Pessoa ' || g, cifrar_texto('cpf' || g), hash_cpf('0000000' || lpad(g::text, 4, '0')), '2022-01-01',
           case when g between 181 and 190 then 'superior' else 'medio' end
      from generate_series(1, 200) g`, [emp]);
  await db.query(`
    insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala, turno)
    select c.id, '[2022-01-01,)',
           case when n between 181 and 190 then 25000 else 2000 + (n % 7) * 100 end,
           case when n <= 140 then 2640 when n <= 180 then 2400 when n <= 190 then 2640 else 2520 end,
           case when n <= 140 then 220 when n <= 180 then 200 when n <= 190 then 220 else 210 end,
           case when n <= 140 then '6x1' when n <= 180 then '5x2' when n <= 190 then '5x2' else '12x36' end,
           case when n % 2 = 0 then 'Manhã' else 'Tarde' end
      from (select id, substring(nome from 8)::int n from colaborador) c`);
  await db.query(`insert into vinculo_empresa values ($1,$2,'leitura')`, [emp, orgContab]);
});
afterAll(async () => { await db.end(); });

describe('diagnóstico de uma empresa com 200 colaboradores', () => {
  let diagId: string;

  it('diagnostica em bem menos de 1 minuto e classifica corretamente', async () => {
    const t = Date.now();
    const r = await executarDiagnostico(rpcPg(db, rh), emp, '2026-10-28');
    expect(Date.now() - t).toBeLessThan(60_000);
    diagId = r.diagnosticoId;
    const d = r.diagnostico;
    expect(d.resumo.total).toBe(200);
    // 40 em 5x2/40h; 140 em 6x1/44h; 10 de alta renda (exceção); 10 em 12x36/42h sem acordo (cumprem a F1, falham na F2)
    expect(d.resumo.porClassificacao).toEqual({ adequado: 40, adequacao_f1: 140, adequacao_f2: 10, excecao: 10 });
    expect(d.resumo.horasPerdidasF2Min).toBe(140 * 240 + 10 * 120);
  });

  it('persiste resumo, itens e o snapshot das regras usadas', async () => {
    const salvo = await carregarDiagnostico(rpcPg(db, rh), diagId);
    expect(salvo.diagnostico.itens).toHaveLength(200);
    const bruto = (await db.query(`select resumo from diagnostico where id=$1`, [diagId])).rows[0].resumo;
    expect(bruto.regrasSnapshot.map((r: { codigo: string }) => r.codigo)).toContain('EC141_ALTA_RENDA');
    expect(bruto.motor).toBeTruthy();
    expect(salvo.diagnostico.resumo.folhaMensalCentavos).toBeGreaterThan(0);
  });
});

describe('permissões', () => {
  it('contador com vínculo de leitura diagnostica a empresa do cliente', async () => {
    const r = await executarDiagnostico(rpcPg(db, contador), emp, '2026-10-28');
    expect(r.diagnostico.resumo.total).toBe(200);
  });
  it('RH de outra organização não consegue', async () => {
    await expect(executarDiagnostico(rpcPg(db, rhB), emp, '2026-10-28')).rejects.toThrow(/sem permissão/);
  });
  it('não grava itens de colaboradores de outra empresa', async () => {
    const empB = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'B','2','me','1','SP') returning id`, [orgB])).rows[0].id;
    const alheio = (await db.query(`select id from colaborador limit 1`)).rows[0].id;
    const r = await rpcPg(db, rhB).rpc('salvar_diagnostico', { p_empresa: empB, p_data: '2026-10-28', p_resumo: {}, p_itens: [{ colaboradorId: alheio, classificacao: 'adequado' }] });
    expect(r.error?.message).toMatch(/fora da empresa/);
  });
  it('colaborador (sem MFA) não roda diagnóstico', async () => {
    const u = await novoUsuario(db, 'colab');
    await db.query(`insert into membro values ($1,$2,'colaborador')`, [orgA, u]);
    await expect(executarDiagnostico(rpcPg(db, u, 'aal1'), emp, '2026-10-28')).rejects.toThrow(/sem permissão/);
  });
  it('empresa sem colaboradores com contrato devolve erro claro', async () => {
    const vazia = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'V','3','me','1','SP') returning id`, [orgA])).rows[0].id;
    await expect(executarDiagnostico(rpcPg(db, rh), vazia, '2026-10-28')).rejects.toThrow(ErroServico);
  });
});

describe('convenção coletiva cadastrada por outra organização', () => {
  it('é aplicada ao diagnóstico do cliente (a exceção não pode sumir em silêncio)', async () => {
    const antes = await executarDiagnostico(rpcPg(db, rh), emp, '2026-10-28');
    const alvo = antes.diagnostico.itens.find((i) => i.nome === 'Pessoa 191')!; // 12x36, 42h
    expect(alvo.classificacao).toBe('adequacao_f2');

    // Sem vínculo jurídico, o acordo de outra organização não pode ser aplicado
    const ac0 = (await db.query(`insert into acordo_coletivo (organizacao_id, tipo, vigencia, status) values ($1,'convencao','[2026-01-01,2029-01-01)','vigente') returning id`, [orgJur])).rows[0].id;
    await expect(db.query(`insert into colaborador_acordo (colaborador_id, acordo_id) select id, $1 from colaborador limit 1`, [ac0])).rejects.toThrow(/sem vínculo jurídico/);
    await db.query(`delete from acordo_coletivo where id = $1`, [ac0]);

    // Cliente concede vínculo jurídico; o escritório cadastra a convenção (sem empresa_id) e vincula aos 10 colaboradores 12x36
    await db.query(`insert into vinculo_empresa values ($1,$2,'juridico')`, [emp, orgJur]);
    const ac = (await db.query(`insert into acordo_coletivo (organizacao_id, tipo, vigencia, status) values ($1,'convencao','[2026-01-01,2029-01-01)','vigente') returning id`, [orgJur])).rows[0].id;
    await db.query(`insert into clausula_jornada (acordo_id, tipo, parametros) values ($1,'regime_compensatorio','{"escala":"12x36","max_diaria_min":720,"max_semanal_min":2520,"folgas_semana":3}')`, [ac]);
    await db.query(`insert into colaborador_acordo (colaborador_id, acordo_id) select id, $1 from colaborador where substring(nome from 8)::int > 190`, [ac]);

    // O RH do cliente enxerga a convenção vinculada, mesmo sem ser da organização dona
    const visivel = await comoUsuario(db, rh, (c) => c.query('select id from acordo_coletivo'));
    expect(visivel.rows.map((r) => r.id)).toEqual([ac]);
    const outra = await comoUsuario(db, rhB, (c) => c.query('select id from acordo_coletivo'));
    expect(outra.rowCount).toBe(0);

    const depois = await executarDiagnostico(rpcPg(db, rh), emp, '2026-10-28');
    const item = depois.diagnostico.itens.find((i) => i.nome === 'Pessoa 191')!;
    expect(item.classificacao).toBe('excecao');
    expect(item.excecao).toBe('acordo');
    expect(item.f2.regrasAplicadas).toContain('EC141_ACORDO_COMP');
    expect(depois.diagnostico.resumo.porClassificacao.adequacao_f2).toBe(0);

    // Convenção vencida deixa de proteger
    await db.query(`update acordo_coletivo set vigencia = '[2026-01-01,2027-06-01)' where id = $1`, [ac]);
    const vencida = await executarDiagnostico(rpcPg(db, rh), emp, '2026-10-28');
    expect(vencida.diagnostico.itens.find((i) => i.nome === 'Pessoa 191')!.classificacao).toBe('adequacao_f2');
  });
});

describe('cenários', () => {
  it('simula, salva e recarrega; bloqueia redução salarial sem salvar', async () => {
    const { diagnosticoId } = await executarDiagnostico(rpcPg(db, rh), emp, '2026-10-28');
    const cli = rpcPg(db, rh);
    const a = await simularESalvar(cli, diagnosticoId, { ...PARAMETROS_PADRAO, tipo: 'contratar', nome: 'Contratar', encargosPct: 30 });
    const b = await simularESalvar(cli, diagnosticoId, { ...PARAMETROS_PADRAO, tipo: 'horas_extras', nome: 'Horas extras' });
    expect(a.cenarioId).toBeTruthy();
    expect(a.resultado.contratacoes).toBeGreaterThan(0);
    expect(b.resultado.custoMensalCentavos).toBeGreaterThan(0);
    const bloq = await simularESalvar(cli, diagnosticoId, { ...PARAMETROS_PADRAO, tipo: 'horas_extras', fatorSalario: 0.9 });
    expect(bloq.resultado.bloqueado).toBe(true);
    expect(bloq.cenarioId).toBeNull();
    const salvo = await carregarDiagnostico(cli, diagnosticoId);
    expect(salvo.cenarios.map((c) => c.nome)).toEqual(['Contratar', 'Horas extras']);
    expect(salvo.cenarios[0]!.resultado!.custoAnualCentavos).toBe(a.resultado.custoAnualCentavos);
  });
  it('cenário de outra organização não é acessível', async () => {
    const { diagnosticoId } = await executarDiagnostico(rpcPg(db, rh), emp, '2026-10-28');
    await expect(carregarDiagnostico(rpcPg(db, rhB), diagnosticoId)).rejects.toThrow(/não encontrado/);
  });
});

describe('auditoria', () => {
  it('registra a criação de diagnósticos e cenários', async () => {
    const r = await db.query(`select tabela, count(*)::int n from auditoria where tabela in ('diagnostico','cenario') group by tabela order by tabela`);
    expect(r.rows.find((x) => x.tabela === 'diagnostico')!.n).toBeGreaterThan(3);
    expect(r.rows.find((x) => x.tabela === 'cenario')!.n).toBeGreaterThan(1);
  });
});
