import { diagnosticar, simular, VERSAO_MOTOR, type Diagnostico, type ParametrosCenario, type Regra, type ResultadoCenario } from '@jc/rules-engine';
import { lerEntradaDiagnostico } from './entrada';
import { chamar, ErroServico, type ClienteRpc } from './rpc';

export type ResultadoExecucao = { diagnosticoId: string; diagnostico: Diagnostico; semContrato: number };

const snapshotRegras = (regras: Regra[]) => regras.map((r) => ({ codigo: r.codigo, vigencia: r.vigencia, escopo: r.escopo, parametros: r.parametros, prioridade: r.prioridade, ativa: r.ativa }));

/** Lê os dados (RLS do usuário), diagnostica com o motor e persiste o resultado. */
export async function executarDiagnostico(cliente: ClienteRpc, empresaId: string, dataReferencia: string, opcoes: { diasOperacao?: number[] } = {}): Promise<ResultadoExecucao> {
  const entrada = lerEntradaDiagnostico(await chamar(cliente, 'diagnostico_entrada', { p_empresa: empresaId, p_data: dataReferencia }));
  if (entrada.colaboradores.length === 0) throw new ErroServico('Nenhum colaborador com contrato vigente na data de referência.');
  const diagnostico = diagnosticar(entrada.colaboradores, dataReferencia, entrada.regras, opcoes);
  const resumo = {
    motor: VERSAO_MOTOR, dataReferencia, fases: diagnostico.fases, resumo: diagnostico.resumo, grupos: diagnostico.grupos,
    semContrato: entrada.semContrato,
    regrasSnapshot: snapshotRegras(entrada.regras), // rastreabilidade: quais regras (e valores) produziram este resultado
  };
  const id = await chamar(cliente, 'salvar_diagnostico', { p_empresa: empresaId, p_data: dataReferencia, p_resumo: resumo, p_itens: diagnostico.itens });
  if (typeof id !== 'string') throw new ErroServico('Falha ao salvar o diagnóstico.');
  return { diagnosticoId: id, diagnostico, semContrato: entrada.semContrato };
}

export type DiagnosticoSalvo = {
  id: string; empresaId: string; criadoEm: string; diagnostico: Diagnostico;
  cenarios: Array<{ id: string; nome: string; parametros: ParametrosCenario; resultado: ResultadoCenario | null }>;
};

export async function carregarDiagnostico(cliente: ClienteRpc, id: string): Promise<DiagnosticoSalvo> {
  const d = (await chamar(cliente, 'diagnostico_obter', { p_id: id })) as null | {
    id: string; empresa_id: string; criado_em: string; data_referencia: string;
    resumo: { fases: Diagnostico['fases']; resumo: Diagnostico['resumo']; grupos: Diagnostico['grupos'] };
    itens: Diagnostico['itens']; cenarios: DiagnosticoSalvo['cenarios'];
  };
  if (!d) throw new ErroServico('Diagnóstico não encontrado.');
  return {
    id: d.id, empresaId: d.empresa_id, criadoEm: d.criado_em, cenarios: d.cenarios,
    diagnostico: { dataReferencia: d.data_referencia, fases: d.resumo.fases, resumo: d.resumo.resumo, grupos: d.resumo.grupos, itens: d.itens },
  };
}

/** Simula e salva o cenário. Cenários que reduzem salário voltam bloqueados e não são salvos. */
export async function simularESalvar(cliente: ClienteRpc, diagnosticoId: string, parametros: ParametrosCenario): Promise<{ cenarioId: string | null; resultado: ResultadoCenario }> {
  const salvo = await carregarDiagnostico(cliente, diagnosticoId);
  const resultado = simular(salvo.diagnostico, parametros);
  if (resultado.bloqueado) return { cenarioId: null, resultado };
  const nome = parametros.nome ?? `${parametros.tipo} (${parametros.fase})`;
  const cenarioId = await chamar(cliente, 'salvar_cenario', { p_diagnostico: diagnosticoId, p_nome: nome, p_parametros: parametros, p_resultado: resultado });
  return { cenarioId: typeof cenarioId === 'string' ? cenarioId : null, resultado };
}
