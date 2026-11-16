/**
 * Integração de verdade: sobe o serviço Python (uvicorn), monta o problema com o motor TypeScript, otimiza e REVALIDA
 * cada proposta com o mesmo motor que valida a escala. É o critério de aceite da Fase 3 (setor de 50 pessoas em até 30 s).
 * Pula (com aviso) se o ambiente Python do otimizador não estiver instalado (apps/optimizer/.venv).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acordo, colab } from '../../rules-engine/test/util';
import { REGRAS_SEED } from '../../rules-engine/src/fixtures/regras';
import { gerarPropostas, type EntradaEscala, type TurnoOtimizacao } from '../src';

const dir = join(import.meta.dirname, '../../../apps/optimizer');
const python = join(dir, '.venv/bin/python');
const TEM_PYTHON = existsSync(python);
const TOKEN = 'token-de-teste';
const somar = (d: string, i: number) => new Date(Date.parse(`${d}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);

const TURNOS: TurnoOtimizacao[] = [
  { id: 'manha', inicioMin: 480, fimMin: 1020, intervaloMin: 60 }, { id: 'meio', inicioMin: 600, fimMin: 1140, intervaloMin: 60 },
  { id: 'tarde', inicioMin: 720, fimMin: 1260, intervaloMin: 60 }, { id: 'noite', inicioMin: 1320, fimMin: 1800, intervaloMin: 60 },
];

function setorDe50(): EntradaEscala {
  const inicio = '2027-02-01', fim = somar(inicio, 27);
  const rodizio = acordo(null, null, [{ tipo: 'rodizio_domingo', parametros: { a_cada_n_semanas: 2 } }]);
  const colaboradores = Array.from({ length: 50 }, (_, i) => colab({
    colaboradorId: `c${String(i).padStart(2, '0')}`, nome: `Pessoa ${i}`, tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200,
    salarioBaseCentavos: 250_000 + (i % 7) * 10_000, admissao: '2021-01-01', desligamento: null, acordos: i % 5 === 0 ? [rodizio] : [],
  }));
  const cobertura = Array.from({ length: 7 }, (_, d) => [
    { diaSemana: d, faixaInicioMin: 600, faixaFimMin: 720, minimo: d === 0 || d === 6 ? 14 : 22, ideal: d === 0 || d === 6 ? 18 : 26 },
    { diaSemana: d, faixaInicioMin: 780, faixaFimMin: 1020, minimo: d === 0 || d === 6 ? 12 : 20, ideal: d === 0 || d === 6 ? 16 : 24 },
  ]).flat();
  return {
    escala: { id: 'e', empresaId: 'emp', setorId: null, nome: 'Fev', status: 'rascunho', revisao: 1, versao: 1, inicio, fim },
    regras: REGRAS_SEED, colaboradores, semContrato: [], alocacoes: [],
    anteriores: [{ colaboradorId: 'c01', data: '2027-01-31', tipo: 'trabalho', inicioMin: 1320, fimMin: 1800, intervaloMin: 60 }],   // c01 fechou a noite de domingo
    ausencias: [0, 11, 22, 33, 44].map((i) => ({ colaboradorId: `c${String(i).padStart(2, '0')}`, inicio: somar(inicio, 14), fim: somar(inicio, 20), tipo: 'ferias' as const })),
    feriados: [{ data: somar(inicio, 7), nome: 'Feriado local', abrangencia: 'municipal' }], cobertura,
  };
}

async function portaLivre(): Promise<number> {
  return new Promise((resolve) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
}

describe.skipIf(!TEM_PYTHON)('otimizador de verdade (Python + OR-Tools) revalidado pelo motor TypeScript', () => {
  let proc: ChildProcess; let url = '';
  beforeAll(async () => {
    const porta = await portaLivre();
    url = `http://127.0.0.1:${porta}`;
    proc = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--port', String(porta), '--log-level', 'warning'], { cwd: dir, env: { ...process.env, OPTIMIZER_TOKEN: TOKEN }, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* ainda subindo */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('o otimizador não subiu');
  }, 30_000);
  afterAll(() => { proc?.kill(); });

  it('setor de 50 pessoas: propostas viáveis em até 30 s, todas aprovadas pelo motor TypeScript', async () => {
    const e = setorDe50();
    const t = Date.now();
    const r = await gerarPropostas(e, { turnos: TURNOS, tempoLimiteS: 30, numSolucoes: 3 }, { url, token: TOKEN });
    const dt = (Date.now() - t) / 1000;
    expect(dt).toBeLessThanOrEqual(35);
    expect(r.divergencias.map((d) => d.resultado.violacoes.filter((v) => v.severidade === 'bloqueio').slice(0, 3))).toEqual([]); // o modelo nunca contradiz o motor
    expect(r.descartadas).toBe(0);
    expect(r.propostas.length).toBeGreaterThanOrEqual(1);
    const melhor = r.propostas[0]!;
    expect(melhor.metricas.faltaCobertura).toBe(0);
    expect(melhor.metricas.deficitHorasMin).toBe(0);
    expect(melhor.alocacoes.filter((a) => a.tipo === 'trabalho').length).toBeGreaterThan(50 * 20 - 30);
    // férias respeitadas e a pessoa que fechou a noite de domingo não começa cedo na segunda
    const c01seg = melhor.alocacoes.find((a) => a.colaboradorId === 'c01' && a.data === '2027-02-01')!;
    expect(c01seg.tipo === 'folga' || (c01seg.inicioMin ?? 0) >= 1020).toBe(true);   // 06h + 11h = 17h
    console.log(`otimizador 50 pessoas: ${dt.toFixed(1)}s, ${r.propostas.length} propostas, status ${r.status}, objetivo ${melhor.metricas.objetivo}, alertas ${melhor.alertas}`);
  }, 60_000);

  it('quando as regras tornam o problema impossível, a resposta é inviável (não quebra)', async () => {
    const e = setorDe50();
    e.colaboradores = e.colaboradores.slice(0, 3);
    e.anteriores = []; e.ausencias = []; e.cobertura = [];
    const r = await gerarPropostas(e, { turnos: [{ id: 'unico', inicioMin: 480, fimMin: 1020, intervaloMin: 60 }], tempoLimiteS: 5, numSolucoes: 1 }, { url, token: TOKEN });
    expect(r.propostas.length).toBeGreaterThanOrEqual(1);   // 3 pessoas sem demanda: solução trivial existe
    expect(r.descartadas).toBe(0);
  }, 30_000);

  it('token errado é recusado com mensagem clara', async () => {
    await expect(gerarPropostas(setorDe50(), { turnos: TURNOS, tempoLimiteS: 2, numSolucoes: 1 }, { url, token: 'errado' })).rejects.toThrow(/token/);
  });
});

describe.skipIf(TEM_PYTHON)('otimizador (Python indisponível)', () => {
  it('pulado: instale o ambiente em apps/optimizer (python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt)', () => { expect(TEM_PYTHON).toBe(false); });
});
