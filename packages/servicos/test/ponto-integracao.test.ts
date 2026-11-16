/** Ponta a ponta: AFD (texto) → leitor → banco (CPF vira hash e vincula sozinho) → conciliação com a escala publicada. */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerAfd } from '../../connectors/src';
import { comoUsuario, novoUsuario, prepararBanco } from '../../db/test/helpers';
import { carregarEntradaEscala, conciliarPonto, publicarEscala } from '../src';
import { rpcPg, rpcPgServidor } from './pg-rpc';

const pad = (n: number, t: number) => String(n).padStart(t, '0');
const CPF_ANA = '52998224725', CPF_BIA = '11144477735';
const cab = () => `000000000${'1'}1${'11222333000181'}${'0'.repeat(14)}${'EMPRESA'.padEnd(150)}${'0'.repeat(17)}2026-02-01`;
const marca = (nsr: number, iso: string, cpf: string) => `${pad(nsr, 9)}3${iso}0${cpf}ABCD`;

describe('importação do ponto ponta a ponta', () => {
  let db: Client;
  let rh: string, org: string, emp: string, A: string, B: string, esc: string;
  const somar = (d: string, i: number) => new Date(Date.parse(`${d}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
  const cliente = () => rpcPg(db, rh);
  // segunda-feira passada, 4 semanas atrás: tudo no passado para a leitura aceitar as datas
  const ini = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 35); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

  beforeAll(async () => {
    db = await prepararBanco();
    rh = await novoUsuario(db, 'rh');
    org = await comoUsuario(db, rh, async (c) => (await c.query<{ id: string }>(`select criar_organizacao('A','empresa') id`)).rows[0]!.id);
    emp = (await db.query(`insert into empresa (organizacao_id, razao_social, cnpj, porte, municipio_ibge, uf) values ($1,'E','11222333000181','medio','3550308','SP') returning id`, [org])).rows[0].id;
    const mk = async (n: string, cpf: string) => {
      const id = (await db.query(`insert into colaborador (empresa_id, nome, cpf_cifrado, cpf_hash, admissao) values ($1,$2,cifrar_texto($3),hash_cpf($3),'2020-01-01') returning id`, [emp, n, cpf])).rows[0].id as string;
      await db.query(`insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala) values ($1,'[2020-01-01,)',3000,2400,200,'5x2')`, [id]);
      return id;
    };
    A = await mk('Ana', CPF_ANA); B = await mk('Bia', CPF_BIA);
    esc = (await db.query(`insert into escala (empresa_id, nome, periodo, criado_por) values ($1,'Semana',daterange($2::date,($2::date + 7)),$3) returning id`, [emp, ini(), rh])).rows[0].id;
    for (let i = 0; i < 5; i++) for (const c of [A, B]) await db.query(`insert into alocacao (escala_id, colaborador_id, data, tipo, inicio_min, fim_min, intervalo_min) values ($1,$2,$3,'trabalho',480,1020,60)`, [esc, c, somar(ini(), i)]);
    await publicarEscala(cliente(), rpcPgServidor(db), esc, rh);
  });
  afterAll(async () => { await db.end(); });

  it('lê o AFD, importa, vincula pelo CPF e a conciliação aponta falta, atraso e marcação em folga', async () => {
    const d = (i: number, hhmm: string) => `${somar(ini(), i)}T${hhmm}:00-0300`;
    const linhas: string[] = [];
    let n = 0;
    const m = (i: number, hhmm: string, cpf: string) => linhas.push(marca(++n, d(i, hhmm), cpf));
    for (const [i, h] of [[0, '08:00'], [0, '12:00'], [0, '13:00'], [0, '17:00']] as const) m(i, h, CPF_ANA);          // Ana: dia certo
    for (const [i, h] of [[1, '08:35'], [1, '17:00']] as const) m(i, h, CPF_ANA);                                         // Ana: 35 min de atraso
    for (const [i, h] of [[0, '08:00'], [0, '17:02']] as const) m(i, h, CPF_BIA);                                         // Bia: dia certo (2 min, dentro da tolerância)
    for (const [i, h] of [[5, '09:00'], [5, '12:00']] as const) m(i, h, CPF_BIA);                                         // Bia: sábado de folga
    // Bia não marcou terça a sexta; Ana não marcou quarta a sexta
    const texto = [cab(), ...linhas].join('\r\n');
    const r = lerAfd(texto);
    expect(r.erros).toEqual([]);
    expect(r.dialeto).toBe('portaria_671');
    expect(r.marcacoes).toHaveLength(linhas.length);

    const imp = (await cliente().rpc('iniciar_importacao_afd', { p_empresa: emp, p_nome: 'afd.txt', p_hash: 'a'.repeat(64), p_dialeto: r.dialeto })).data as string;
    const res = await cliente().rpc('importar_marcacoes_afd', { p_importacao: imp, p_marcacoes: r.marcacoes.map((x) => ({ momento: x.momento, nsr: x.nsr, tipo: x.tipoIdentificador, identificador: x.identificador })) });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ recebidas: linhas.length, inseridas: linhas.length, jaExistiam: 0 });
    await cliente().rpc('finalizar_importacao_afd', { p_importacao: imp, p_status: 'concluida', p_relatorio: { ok: true } });
    expect((await comoUsuario(db, rh, (c) => c.query(`select * from identificadores_pendentes($1)`, [emp]))).rowCount).toBe(0);     // CPF cadastrado: nada pendente
    expect((await db.query(`select count(*)::int n from marcacao_ponto where colaborador_id is not null`)).rows[0].n).toBe(linhas.length);

    const marc = (await db.query<{ colaborador_id: string; momento: string }>(`select colaborador_id, momento::text from marcacao_ponto`)).rows;
    const c = conciliarPonto(await carregarEntradaEscala(cliente(), esc), marc);
    const dia = (colab: string, i: number) => c.dias.find((x) => x.colaboradorId === colab && x.data === somar(ini(), i))!;
    expect(dia(A, 0)).toMatchObject({ codigos: [], apuradoMin: 480, intervaloRealizadoMin: 60 });
    expect(dia(A, 1)).toMatchObject({ codigos: ['ATRASO'], atrasoMin: 35 });
    expect(dia(A, 2).codigos).toEqual(['SEM_MARCACAO']);
    expect(dia(B, 0).codigos).toEqual([]);
    expect(dia(B, 5).codigos).toEqual(['MARCACAO_EM_FOLGA']);
    const ana = c.resumo.find((x) => x.nome === 'Ana')!;
    expect(ana).toMatchObject({ diasPrevistos: 5, diasSemMarcacao: 3, atrasoMin: 35 });
    expect(c.resumo.find((x) => x.nome === 'Bia')).toMatchObject({ diasSemMarcacao: 4 });
  });

  it('reimportar o mesmo arquivo é recusado e o ponto do colaborador só é visível para ele e para a gestão', async () => {
    await expect(Promise.resolve(cliente().rpc('iniciar_importacao_afd', { p_empresa: emp, p_nome: 'afd.txt', p_hash: 'a'.repeat(64), p_dialeto: 'portaria_671' }))).resolves.toMatchObject({ error: { message: expect.stringMatching(/já foi importado/) } });
    const ua = await novoUsuario(db, 'ua');
    await db.query(`insert into membro values ($1,$2,'colaborador')`, [org, ua]);
    await db.query(`update colaborador set usuario_id=$1 where id=$2`, [ua, A]);
    const minhas = await comoUsuario(db, ua, (c) => c.query(`select distinct colaborador_id from marcacao_ponto`));
    expect(minhas.rows.map((x) => x.colaborador_id)).toEqual([A]);
  });
});
