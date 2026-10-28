import { lerPlanilha, validarColaboradores, type ColaboradorImportado, type ErroLinha, type Mapeamento } from '@jc/connectors';
import type { Pool, PoolClient } from 'pg';
import type { Armazenamento } from './armazenamento';

export const FILA_IMPORTAR_COLABORADORES = 'importar-colaboradores';
const MAX_ERROS_NO_RELATORIO = 1000;

export type RelatorioImportacao = {
  totalLinhas: number;
  criados: number;
  atualizados: number;
  semAlteracao: number;
  ignoradas: number;
  setoresCriados: number;
  errosTotal: number;
  erros: ErroLinha[];
  avisosTotal: number;
  dataVigencia: string;
  duracaoMs: number;
};

type Importacao = {
  id: string; organizacao_id: string; empresa_id: string; arquivo_path: string;
  mapeamento: Mapeamento | null; criado_por: string | null; status: string;
};

/**
 * Processa uma importação de colaboradores. O job só carrega o id; tudo o mais vem da linha `importacao`,
 * criada pelo usuário sob RLS, então um job forjado não ganha permissões que o usuário não tenha.
 * Linhas válidas são gravadas mesmo que outras falhem (modo parcial); o relatório lista cada erro.
 * Idempotente: reprocessar uma importação já concluída não faz nada.
 */
export async function processarImportacao(pool: Pool, importacaoId: string, armazenamento: Armazenamento, opcoes: { hoje?: string } = {}): Promise<RelatorioImportacao | null> {
  const inicio = Date.now();
  const cx = await pool.connect();
  try {
    await cx.query('begin');
    const { rows } = await cx.query<Importacao>(`select id, organizacao_id, empresa_id, arquivo_path, mapeamento, criado_por, status from importacao where id = $1 for update`, [importacaoId]);
    const imp = rows[0];
    if (!imp) throw new Error(`Importação ${importacaoId} não encontrada`);
    if (imp.status !== 'processando') { await cx.query('rollback'); return null; }
    if (!imp.empresa_id || !imp.mapeamento) throw new Error('Importação sem empresa ou mapeamento');
    // Defesa em profundidade (o banco também valida): nunca ler arquivo fora da pasta da organização.
    if (!imp.arquivo_path.startsWith(`${imp.organizacao_id}/`) || imp.arquivo_path.includes('..')) throw new Error('Caminho do arquivo fora da pasta da organização');
    // As escritas ficam atribuídas ao usuário que pediu a importação (auditoria).
    await cx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: imp.criado_por })]);

    let relatorio: RelatorioImportacao;
    try {
      const arquivo = await armazenamento.ler(imp.arquivo_path);
      const planilha = await lerPlanilha(arquivo, imp.arquivo_path);
      const val = validarColaboradores(planilha.linhas, imp.mapeamento);
      const hoje = opcoes.hoje ?? (await cx.query<{ d: string }>(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).rows[0]!.d;
      const erros: ErroLinha[] = [...val.erros];
      let criados = 0, atualizados = 0, semAlteracao = 0, setoresCriados = 0, avisosTotal = 0;
      const setores = new Map<string, string>();

      for (const c of val.validas) {
        avisosTotal += c.avisos.length;
        await cx.query('savepoint linha');
        try {
          const setorId = c.setor ? await obterSetor(cx, imp.empresa_id, c.setor, setores, () => setoresCriados++) : null;
          const r = await gravarColaborador(cx, imp.empresa_id, c, setorId, hoje);
          if (r === 'criado') criados++; else if (r === 'atualizado') atualizados++; else semAlteracao++;
          await cx.query('release savepoint linha');
        } catch (e) {
          await cx.query('rollback to savepoint linha');
          erros.push({ linha: c.linha, campo: 'geral', valor: c.nome, mensagem: mensagemDeErro(e) });
        }
      }
      erros.sort((a, b) => a.linha - b.linha);
      relatorio = {
        totalLinhas: planilha.linhas.length, criados, atualizados, semAlteracao, ignoradas: val.ignoradas, setoresCriados,
        errosTotal: erros.length, erros: erros.slice(0, MAX_ERROS_NO_RELATORIO), avisosTotal, dataVigencia: hoje, duracaoMs: Date.now() - inicio,
      };
      await cx.query(`update importacao set status = 'concluida', relatorio = $2 where id = $1`, [imp.id, JSON.stringify(relatorio)]);
    } catch (e) {
      // Falha geral (arquivo ilegível, mapeamento inválido): nada é gravado.
      await cx.query('rollback');
      await pool.query(`update importacao set status = 'erro', relatorio = $2 where id = $1 and status = 'processando'`, [importacaoId, JSON.stringify({ mensagem: mensagemDeErro(e) })]);
      throw e;
    }
    await cx.query('commit');
    return relatorio;
  } finally {
    cx.release();
  }
}

function mensagemDeErro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/duplicate key|unique/i.test(m)) return 'Registro duplicado.';
  if (/exclusion|conflicting/i.test(m)) return 'Conflito de vigência com outro contrato do colaborador.';
  return m.slice(0, 300);
}

async function obterSetor(cx: PoolClient, empresaId: string, nome: string, cache: Map<string, string>, aoCriar: () => void): Promise<string> {
  const chave = nome.toLowerCase();
  const emCache = cache.get(chave);
  if (emCache) return emCache;
  const achado = await cx.query<{ id: string }>(
    `select s.id from setor s join unidade u on u.id = s.unidade_id where u.empresa_id = $1 and lower(s.nome) = $2 limit 1`, [empresaId, chave]);
  let id = achado.rows[0]?.id;
  if (!id) {
    let unidade = (await cx.query<{ id: string }>(`select id from unidade where empresa_id = $1 order by nome limit 1`, [empresaId])).rows[0]?.id;
    if (!unidade) {
      unidade = (await cx.query<{ id: string }>(
        `insert into unidade (empresa_id, nome, municipio_ibge) select id, 'Matriz', municipio_ibge from empresa where id = $1 returning id`, [empresaId])).rows[0]!.id;
    }
    id = (await cx.query<{ id: string }>(`insert into setor (unidade_id, nome) values ($1, $2) returning id`, [unidade, nome])).rows[0]!.id;
    aoCriar();
  }
  cache.set(chave, id);
  return id;
}

type Contrato = { id: string; inicio: string; salario: string; jornada: number; divisor: number; tipo: string; folgas: number | null; turno: string | null; he: number };

async function gravarColaborador(cx: PoolClient, empresaId: string, c: ColaboradorImportado, setorId: string | null, hoje: string): Promise<'criado' | 'atualizado' | 'sem_alteracao'> {
  const dados = [empresaId, setorId, c.nome, c.cpf, c.matricula, c.cargo, c.cbo, c.admissao, c.desligamento, c.escolaridade, c.telefone];
  const existente = await cx.query<{ id: string }>(`select id from colaborador where empresa_id = $1 and cpf_hash = hash_cpf($2)`, [empresaId, c.cpf]);
  let colaboradorId: string;
  let novo = false;
  if (existente.rows[0]) {
    colaboradorId = existente.rows[0].id;
    await cx.query(
      `update colaborador set setor_id = coalesce($2, setor_id), nome = $3, matricula = coalesce($4, matricula), cargo = coalesce($5, cargo), cbo = coalesce($6, cbo),
              desligamento = $7, escolaridade = coalesce($8, escolaridade), telefone_cifrado = coalesce(cifrar_texto($9), telefone_cifrado)
        where id = $1 and (setor_id, nome, matricula, cargo, cbo, desligamento, escolaridade) is distinct from
              (coalesce($2, setor_id), $3, coalesce($4, matricula), coalesce($5, cargo), coalesce($6, cbo), $7, coalesce($8, escolaridade)) `,
      [colaboradorId, setorId, c.nome, c.matricula, c.cargo, c.cbo, c.desligamento, c.escolaridade, c.telefone]);
  } else {
    novo = true;
    colaboradorId = (await cx.query<{ id: string }>(
      `insert into colaborador (empresa_id, setor_id, nome, cpf_cifrado, cpf_hash, matricula, cargo, cbo, admissao, desligamento, escolaridade, telefone_cifrado)
       values ($1, $2, $3, cifrar_texto($4), hash_cpf($4), $5, $6, $7, $8, $9, $10, cifrar_texto($11)) returning id`, dados)).rows[0]!.id;
  }

  const salario = (c.salarioCentavos / 100).toFixed(2);
  const atual = (await cx.query<Contrato>(
    `select id, lower(vigencia)::text inicio, salario_base::text salario, jornada_semanal_min jornada, divisor, tipo_escala tipo, folgas_semana folgas, turno, horas_extras_mensais_min he
       from contrato_versao where colaborador_id = $1 and upper_inf(vigencia) order by lower(vigencia) desc limit 1`, [colaboradorId])).rows[0];
  const igual = atual && atual.salario === salario && atual.jornada === c.jornadaSemanalMin && atual.divisor === c.divisor && atual.tipo === c.tipoEscala
    && atual.folgas === c.folgasSemana && atual.turno === c.turno && atual.he === c.horasExtrasMensaisMin;
  const campos = [colaboradorId, salario, c.jornadaSemanalMin, c.divisor, c.tipoEscala, c.folgasSemana, c.turno, c.horasExtrasMensaisMin];
  const inserir = (de: string) => cx.query(
    `insert into contrato_versao (colaborador_id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala, folgas_semana, turno, horas_extras_mensais_min)
     values ($1, daterange($9::date, null, '[)'), $2, $3, $4, $5, $6, $7, $8)`, [...campos, de]);

  if (!atual) { await inserir(novo ? c.admissao : maxIso(c.admissao, hoje)); return novo ? 'criado' : 'atualizado'; }
  if (igual) return novo ? 'criado' : 'sem_alteracao';
  if (atual.inicio >= hoje) {
    // Alteração no mesmo dia (ou contrato futuro): corrige a versão em vigor em vez de criar uma de vigência vazia.
    await cx.query(`update contrato_versao set salario_base = $2, jornada_semanal_min = $3, divisor = $4, tipo_escala = $5, folgas_semana = $6, turno = $7, horas_extras_mensais_min = $8 where colaborador_id = $1 and id = $9`, [...campos, atual.id]);
  } else {
    await cx.query(`update contrato_versao set vigencia = daterange(lower(vigencia), $2::date, '[)') where id = $1`, [atual.id, hoje]);
    await inserir(hoje);
  }
  return 'atualizado';
}

const maxIso = (a: string, b: string) => (a >= b ? a : b);
