import {
  calcularHoras, temBloqueio, validarEscala, resolverRegras, VERSAO_MOTOR,
  type Alocacao, type ResumoHoras, type Violacao,
} from '@jc/rules-engine';
import { lerEntradaEscala, paraEscalaInput, type EntradaEscala } from './escala-entrada';
import { chamar, ErroServico, type ClienteRpc } from './rpc';

export type ResultadoValidacao = {
  entrada: EntradaEscala;
  violacoes: Violacao[];
  bloqueios: number; alertas: number; infos: number;
  podePublicar: boolean;
  /** Quem está na escala sem contrato vigente no período: não é validado, e precisa ser regularizado. */
  semContrato: EntradaEscala['semContrato'];
};

export async function carregarEntradaEscala(cliente: ClienteRpc, escalaId: string): Promise<EntradaEscala> {
  return lerEntradaEscala(await chamar(cliente, 'escala_entrada', { p_escala: escalaId }));
}

/**
 * Valida uma escala com o motor. `alocacoes` permite validar uma edição ainda não gravada (editor ao vivo):
 * por padrão usa as gravadas. Lançamento de quem está sem contrato vigente vira bloqueio.
 */
export function validarEntrada(entrada: EntradaEscala, alocacoes: Alocacao[] = entrada.alocacoes): ResultadoValidacao {
  const semContratoIds = new Set(entrada.semContrato.map((c) => c.id));
  const violacoes = validarEscala(paraEscalaInput(entrada, alocacoes), entrada.colaboradores, entrada.regras)
    // Quem não tem contrato aparece como "desconhecido" no motor; aqui o motivo real é mais útil.
    .map((v): Violacao => v.codigo === 'COLABORADOR_DESCONHECIDO' && v.colaboradorId && semContratoIds.has(v.colaboradorId)
      ? { ...v, mensagem: `${entrada.semContrato.find((c) => c.id === v.colaboradorId)!.nome} não tem contrato vigente no período.`, sugestao: 'Cadastre o contrato do colaborador antes de escalá-lo.' }
      : v);
  const conta = (s: Violacao['severidade']) => violacoes.filter((v) => v.severidade === s).length;
  return {
    entrada, violacoes, bloqueios: conta('bloqueio'), alertas: conta('alerta'), infos: conta('info'),
    podePublicar: entrada.escala.status === 'rascunho' && alocacoes.length > 0 && !temBloqueio(violacoes), semContrato: entrada.semContrato,
  };
}

export async function validarEscalaSalva(cliente: ClienteRpc, escalaId: string): Promise<ResultadoValidacao> {
  return validarEntrada(await carregarEntradaEscala(cliente, escalaId));
}

export type ResumoColaborador = { colaboradorId: string; nome: string; horas: ResumoHoras };

/** Horas, extras, noturno, domingos e feriados por colaborador (para o painel do editor e o relatório). */
export function resumirHoras(entrada: EntradaEscala, alocacoes: Alocacao[] = entrada.alocacoes): ResumoColaborador[] {
  return entrada.colaboradores.map((c) => {
    const proprias = alocacoes.filter((a) => a.colaboradorId === c.colaboradorId);
    const regra = (d: string) => resolverRegras(c, d, entrada.regras);
    return {
      colaboradorId: c.colaboradorId, nome: c.nome,
      horas: calcularHoras(proprias, entrada.feriados, {
        maxDiariaMin: regra(entrada.escala.inicio).maxDiariaMin, maxSemanalMin: (d) => regra(d).maxSemanalMin,
        periodo: { inicio: entrada.escala.inicio, fim: entrada.escala.fim },
      }),
    };
  });
}

export type ResultadoPublicacao = { hash: string; violacoes: Violacao[]; versaoMotor: string };

/**
 * Publica a escala. Dois clientes de propósito:
 *  - `cliente`: o do usuário (RLS). Ler a entrada por ele já prova que o usuário enxerga a escala.
 *  - `clienteServidor`: service_role, só no servidor, porque `publicar_escala` não é executável pelo usuário.
 * O servidor revalida aqui e o banco confere a revisão: se a escala mudou entre a validação e a publicação, recusa.
 */
export async function publicarEscala(cliente: ClienteRpc, clienteServidor: ClienteRpc, escalaId: string, usuarioId: string): Promise<ResultadoPublicacao> {
  const r = validarEntrada(await carregarEntradaEscala(cliente, escalaId));
  if (r.entrada.escala.status !== 'rascunho') throw new ErroServico('Só rascunhos podem ser publicados.');
  if (r.entrada.alocacoes.length === 0) throw new ErroServico('A escala não tem nenhuma alocação.');
  if (r.bloqueios > 0) throw new ErroServico(`A escala tem ${r.bloqueios} bloqueio(s) e não pode ser publicada.`);
  const hash = await chamar(clienteServidor, 'publicar_escala', {
    p_escala: escalaId, p_revisao: r.entrada.escala.revisao, p_violacoes: r.violacoes, p_ator: usuarioId, p_motor: VERSAO_MOTOR,
  });
  if (typeof hash !== 'string') throw new ErroServico('Falha ao publicar a escala.');
  return { hash, violacoes: r.violacoes, versaoMotor: VERSAO_MOTOR };
}

export async function registrarCiencia(cliente: ClienteRpc, escalaId: string): Promise<void> {
  await chamar(cliente, 'registrar_ciencia', { p_escala: escalaId });
}
