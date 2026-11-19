/**
 * Critério de aceite da Fase 2: "escala mensal de 30 pessoas publicada sem violações de bloqueio".
 * Percorre o caminho do editor: salvar a grade (RPC com trava de revisão), validar, publicar pelo servidor e dar ciência.
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comoUsuario, novoUsuario, prepararBanco } from '../../db/test/helpers';
import { carregarEntradaEscala, ErroServico, publicarEscala, registrarCiencia, resumirHoras, validarEscalaSalva } from '../src';
import { rpcPg, rpcPgServidor } from './pg-rpc';

const N = 30;
const INICIO = '2027-02-01'; // segunda-feira; fevereiro de 2027 tem exatamente 4 semanas
const somar = (d: string, i: number) => new Date(Date.parse(`${d}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

let db: Client;
let admin: string, org: string, emp: string, escala: string;
let colaboradores: string[] = [];
let usuarioDe: Record<string, string> = {};

/** Três turmas de 10 pessoas com folgas diferentes: sáb+dom, dom+seg e seg+ter. Segunda a sexta sempre tem ao menos 10 pessoas. */
const FOLGAS: number[][] = [[6, 0], [0, 1], [1, 2]];
const turma = (i: number) => i % 3;
function grade(excecoes: Array<(c: number, d: string, base: any) => any | null> = []) {
  const itens: Array<Record<string, unknown>> = [];
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 28; k++) {
      const d = somar(INICIO, k);
      const folga = FOLGAS[turma(i)]!.includes(dow(d));
      let a: any = folga ? { colaboradorId: colaboradores[i], data: d, tipo: 'folga' } : { colaboradorId: colaboradores[i], data: d, tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 };
      for (const e of excecoes) a = e(i, d, a);
      if (a) itens.push(a);
    }
  }
  return itens;
}

beforeAll(async () => {
  db = await prepararBanco();
  admin = await novoUsuario(db, 'admin');
  org = await comoUsuario(db, admin, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('Varejo','empresa') id`)).rows[0]!.id);
  emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'Loja','1','medio','3550308','SP') returning id`, [org])).rows[0].id;
  await db.query(`
    insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao)
    select $1, 'Pessoa ' || lpad(g::text, 2, '0'), cifrar_texto('cpf' || g), hash_cpf('c' || g), '2022-01-01' from generate_series(1, ${N}) g`, [emp]);
  await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala)
                  select id, '[2022-01-01,)', 2500, 2400, 200, '5x2' from colaborador where empresa_id = $1`, [emp]);
  colaboradores = (await db.query<{ id: string }>(`select id from colaborador where empresa_id=$1 order by nome`, [emp])).rows.map((r) => r.id);
  // a primeira pessoa tem acesso ao app (para a ciência)
  const u = await novoUsuario(db, 'pessoa01');
  await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, u]);
  await db.query(`update colaborador set usuario_id=$1 where id=$2`, [u, colaboradores[0]]);
  usuarioDe = { [colaboradores[0]!]: u };
  // cobertura: pelo menos 10 pessoas das 08h às 17h, de segunda a sexta (e 8 aos sábados/domingos? não exigido)
  await db.query(`insert into demanda_cobertura (empresa_id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal)
                  select $1, null, d, 480, 1020, 10, 20 from generate_series(1,5) d`, [emp]);
  escala = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Fevereiro/2027','[2027-02-01,2027-03-01)',$2) returning id`, [emp, admin])).rows[0].id;
});
afterAll(async () => { await db.end(); });

const cliente = () => rpcPg(db, admin);
/** Mesmo formato que o editor envia a `salvar_alocacoes`. */
const paraGravacao = (itens: Array<Record<string, unknown>>) => itens.map((a) => ({
  colaboradorId: a.colaboradorId, data: a.data, tipo: a.tipo, inicioMin: a.inicioMin ?? null, fimMin: a.fimMin ?? null, intervaloMin: a.intervaloMin ?? 0, turnoModeloId: null,
}));
async function gravar(itens: unknown[]) {
  const e = await carregarEntradaEscala(cliente(), escala);
  const r = await cliente().rpc('salvar_alocacoes', { p_escala: escala, p_revisao: e.escala.revisao, p_alocacoes: paraGravacao(itens as Array<Record<string, unknown>>) });
  if (r.error) throw new ErroServico(r.error.message);
}

describe('aceite da Fase 2: escala mensal de 30 pessoas', () => {
  it('gravar a grade de 840 lançamentos é rápido e a leitura devolve tudo', async () => {
    const t = Date.now();
    await gravar(grade());
    expect(Date.now() - t).toBeLessThan(30_000);   // limite folgado: o runner do CI é bem mais lento que a máquina local
    expect((await db.query(`select count(*)::int n from alocacao where escala_id=$1`, [escala])).rows[0].n).toBe(N * 28);
    const e = await carregarEntradaEscala(cliente(), escala);
    expect(e.colaboradores).toHaveLength(N);
    expect(e.alocacoes).toHaveLength(N * 28);
  });

  it('a escala não tem nenhum bloqueio e valida em tempo hábil', async () => {
    const t = Date.now();
    const r = await validarEscalaSalva(cliente(), escala);
    expect(Date.now() - t).toBeLessThan(15_000);
    expect(r.violacoes.filter((v) => v.severidade === 'bloqueio'), JSON.stringify(r.violacoes.filter((v) => v.severidade === 'bloqueio').slice(0, 3))).toEqual([]);
    expect(r.podePublicar).toBe(true);
    expect(r.violacoes.some((v) => v.codigo === 'COBERTURA_MINIMA')).toBe(false); // sempre há 10 ou mais pessoas de seg a sex
  });

  it('cada pessoa fecha 4 semanas de 40 horas, sem hora extra', async () => {
    const e = await carregarEntradaEscala(cliente(), escala);
    for (const r of resumirHoras(e)) {
      expect(r.horas.trabalhadasMin, r.nome).toBe(4 * 2400);
      expect(r.horas.extrasMin, r.nome).toBe(0);
      expect(r.horas.diasTrabalhados, r.nome).toBe(20);
    }
  });

  it('um sexto dia de trabalho para qualquer pessoa vira bloqueio e a publicação é recusada', async () => {
    const original = grade();
    // pessoa 08 (turma 1: folga dom+seg) passa a trabalhar também na segunda 08/02
    const ruim = grade([(c, d, a) => (c === 7 && d === '2027-02-08' ? { ...a, tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 } : a)]);
    await gravar(ruim);
    const r = await validarEscalaSalva(cliente(), escala);
    const bloqueios = r.violacoes.filter((v) => v.severidade === 'bloqueio').map((v) => [v.colaboradorId, v.codigo]);
    expect(bloqueios).toContainEqual([colaboradores[7], 'FOLGAS_SEMANA']);
    expect(bloqueios).toContainEqual([colaboradores[7], 'LIMITE_SEMANAL']);
    expect(new Set(bloqueios.map((b) => b[0]))).toEqual(new Set([colaboradores[7]])); // só essa pessoa é afetada
    await expect(publicarEscala(cliente(), rpcPgServidor(db), escala, admin)).rejects.toThrow(/bloqueio/);
    expect((await db.query(`select status from escala where id=$1`, [escala])).rows[0].status).toBe('rascunho');
    await gravar(original); // volta ao estado correto
  });

  it('publica; o banco congela a escala com hash e o colaborador dá a ciência', async () => {
    const t = Date.now();
    const pub = await publicarEscala(cliente(), rpcPgServidor(db), escala, admin);
    expect(Date.now() - t).toBeLessThan(20_000);
    expect(pub.hash).toMatch(/^[0-9a-f]{64}$/);
    const linha = (await db.query(`select status, versao, publicada_por, hash_publicado from escala where id=$1`, [escala])).rows[0];
    expect(linha).toMatchObject({ status: 'publicada', versao: 1, publicada_por: admin, hash_publicado: pub.hash });
    expect(pub.violacoes.every((v) => v.severidade !== 'bloqueio')).toBe(true);
    // imutável
    await expect(db.query(`delete from alocacao where escala_id=$1`, [escala])).rejects.toThrow(/imutável/);
    // ciência da pessoa com acesso
    const uid = usuarioDe[colaboradores[0]!]!;
    await registrarCiencia(rpcPg(db, uid), escala);
    expect((await db.query(`select hash_escala from ciencia where escala_id=$1`, [escala])).rows).toEqual([{ hash_escala: pub.hash }]);
    // o colaborador enxerga só a própria escala publicada (28 dias)
    const minhas = await comoUsuario(db, uid, (c) => c.query(`select count(*)::int n, count(distinct colaborador_id)::int p from alocacao where escala_id=$1`, [escala]));
    expect(minhas.rows[0]).toEqual({ n: 28, p: 1 });
  });
});
