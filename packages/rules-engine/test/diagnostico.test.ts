import { describe, expect, it } from 'vitest';
import { diagnosticar, diagnosticarColaborador, obterFases, type ContextoColaborador } from '../src';
import { REGRAS_SEED as R } from '../src/fixtures/regras';
import { acordo, colab } from './util';

const HOJE = '2026-10-28';
const diag = (c: ContextoColaborador, ref = HOJE) => diagnosticarColaborador(c, ref, R);

describe('fases lidas das regras', () => {
  it('vêm do cadastro, não do código', () => {
    expect(obterFases(R)).toEqual({ f1Inicio: '2026-12-15', f1Fim: '2027-12-15', f2Inicio: '2027-12-15' });
    const f2 = R.map((r) => (r.codigo === 'EC141_F2' ? { ...r, vigencia: { inicio: '2028-03-01', fim: null } } : r));
    expect(obterFases(f2).f2Inicio).toBe('2028-03-01');
  });
});

describe('classificação', () => {
  it('44h em 6x1 precisa adequar já na F1 (42h, divisor 210) e chega a 40h na F2', () => {
    const d = diag(colab());
    expect(d.classificacao).toBe('adequacao_f1');
    expect(d.f1).toMatchObject({ horasAlvoMin: 2520, horasPerdidasMin: 120, divisor: 210, diasFolgaFaltantes: 1, prazo: '2026-12-15' });
    expect(d.f1!.motivos).toEqual(['folgas_insuficientes', 'jornada_acima_do_teto']);
    expect(d.f2).toMatchObject({ horasAlvoMin: 2400, horasPerdidasMin: 240, divisor: 200 });
    expect(d.valorHoraAtualCentavos).toBeCloseTo(1000);
    expect(d.f1!.valorHoraCentavos).toBeCloseTo(220000 / 210);
    expect(d.f2.valorHoraCentavos).toBeCloseTo(1100);
  });
  it('40h em 5x2 já está adequado e nada muda', () => {
    const d = diag(colab({ jornadaSemanalMin: 2400, divisorContrato: 200, tipoEscala: '5x2' }));
    expect(d.classificacao).toBe('adequado');
    expect(d.f2).toMatchObject({ horasAlvoMin: 2400, horasPerdidasMin: 0, divisor: 200, conforme: true });
    expect(d.f2.valorHoraCentavos).toBeCloseTo(d.valorHoraAtualCentavos);
  });
  it('36h em 6x1 só muda a escala: horas, divisor e valor da hora ficam iguais', () => {
    const d = diag(colab({ jornadaSemanalMin: 2160, divisorContrato: 180 }));
    expect(d.classificacao).toBe('adequacao_f1');
    expect(d.f1).toMatchObject({ horasAlvoMin: 2160, horasPerdidasMin: 0, divisor: 180, motivos: ['folgas_insuficientes'] });
    expect(d.f2).toMatchObject({ horasAlvoMin: 2160, divisor: 180 });
    expect(d.f2.valorHoraCentavos).toBeCloseTo(d.valorHoraAtualCentavos);
  });
  it('42h em 5x2 só precisa adequar na F2', () => {
    const d = diag(colab({ jornadaSemanalMin: 2520, divisorContrato: 210, tipoEscala: '5x2' }));
    expect(d.classificacao).toBe('adequacao_f2');
    expect(d.f1!.conforme).toBe(true);
    expect(d.f2.horasPerdidasMin).toBe(120);
  });
  it('44h em 5x2 precisa reduzir jornada na F1', () => {
    expect(diag(colab({ tipoEscala: '5x2' })).classificacao).toBe('adequacao_f1');
  });
  it('contrato com divisor menor que o da regra preserva o divisor do contrato', () => {
    const d = diag(colab({ jornadaSemanalMin: 2520, divisorContrato: 190, tipoEscala: '5x2' }));
    expect(d.f1!.divisor).toBe(190);
    expect(d.f2.divisor).toBe(190);
  });
  it('escala personalizada sem folgas informadas gera alerta e presume 1 folga', () => {
    const d = diag(colab({ tipoEscala: 'personalizada', jornadaSemanalMin: 2400, divisorContrato: 200 }));
    expect(d.classificacao).toBe('adequacao_f1');
    expect(d.alertas[0]).toMatch(/personalizada/);
    expect(diag(colab({ tipoEscala: 'personalizada', folgasSemana: 2, jornadaSemanalMin: 2400, divisorContrato: 200 })).classificacao).toBe('adequado');
  });
});

describe('exceções', () => {
  const rico = { escolaridade: 'superior' as const, salarioBaseCentavos: 2_500_000 };
  it('alta renda em 5x2 com 44h: exceção, sem reduzir horas nem alterar o divisor', () => {
    const d = diag(colab({ ...rico, tipoEscala: '5x2' }));
    expect(d.classificacao).toBe('excecao');
    expect(d.excecao).toBe('alta_renda');
    expect(d.f2).toMatchObject({ horasAlvoMin: 2640, horasPerdidasMin: 0, divisor: 220, conforme: true });
  });
  it('alta renda em 6x1 ainda precisa passar para 5x2 (só a jornada é livre)', () => {
    const d = diag(colab(rico));
    expect(d.classificacao).toBe('adequacao_f1');
    expect(d.f1!.motivos).toEqual(['folgas_insuficientes']);
    expect(d.f1!.horasPerdidasMin).toBe(0);
  });
  it('alta renda no limite exato do salário é exceção; um centavo abaixo, não', () => {
    expect(diag(colab({ ...rico, salarioBaseCentavos: 2_118_887, tipoEscala: '5x2' })).classificacao).toBe('excecao');
    expect(diag(colab({ ...rico, salarioBaseCentavos: 2_118_886, tipoEscala: '5x2' })).classificacao).toBe('adequacao_f1');
  });
  const doze = { tipo: 'regime_compensatorio' as const, parametros: { escala: '12x36', max_diaria_min: 720, max_semanal_min: 2520, folgas_semana: 3 } };
  it('12x36 coberto por acordo vigente é exceção por acordo', () => {
    const d = diag(colab({ tipoEscala: '12x36', jornadaSemanalMin: 2520, divisorContrato: 210, acordos: [acordo('2026-01-01', '2030-01-01', [doze])] }));
    expect(d.classificacao).toBe('excecao');
    expect(d.excecao).toBe('acordo');
    expect(d.f2.horasPerdidasMin).toBe(0);
  });
  const doze44 = { tipo: 'regime_compensatorio' as const, parametros: { escala: '12x36', max_diaria_min: 720, max_semanal_min: 2640, folgas_semana: 3 } };
  it('acordo que vence na transição devolve o colaborador à adequação, com prazo', () => {
    const d = diag(colab({ tipoEscala: '12x36', jornadaSemanalMin: 2640, divisorContrato: 220, acordos: [acordo('2026-01-01', '2027-06-30', [doze44])] }));
    expect(d.classificacao).toBe('adequacao_f1');
    expect(d.f1!.prazo).toBe('2027-06-30');
  });
  it('acordo vencido ou em rascunho não protege ninguém', () => {
    const base = { tipoEscala: '12x36' as const, jornadaSemanalMin: 2640, divisorContrato: 220 };
    expect(diag(colab({ ...base, acordos: [acordo('2025-01-01', '2026-01-01', [doze44])] })).classificacao).toBe('adequacao_f1');
    expect(diag(colab({ ...base, acordos: [acordo('2026-01-01', null, [doze44], 'rascunho')] })).classificacao).toBe('adequacao_f1');
    expect(diag(colab({ ...base, acordos: [acordo('2026-01-01', null, [doze44])] })).classificacao).toBe('excecao');
  });
  it('12x36 de 42h sem acordo: 3 folgas cumprem o mínimo, só a F2 (40h) exige ajuste', () => {
    const d = diag(colab({ tipoEscala: '12x36', jornadaSemanalMin: 2520, divisorContrato: 210 }));
    expect(d.f1!.conforme).toBe(true);
    expect(d.classificacao).toBe('adequacao_f2');
  });
  it('terceirizada pública: prazo de adequação é 16/10/2027 e o alvo é o da fase 1', () => {
    const d = diag(colab({ empresa: { porte: 'grande', terceirizadaPublica: true } }));
    expect(d.classificacao).toBe('adequacao_f1');
    expect(d.f1!.prazo).toBe('2027-10-16');
    expect(d.f1!.horasAlvoMin).toBe(2520);
  });
});

describe('data de referência', () => {
  it('dentro da fase 2 não há mais fase 1', () => {
    const d = diag(colab(), '2028-01-10');
    expect(d.f1).toBeNull();
    expect(d.classificacao).toBe('adequacao_f2');
  });
  it('dentro da fase 1 o prazo é a própria data de referência', () => {
    expect(diag(colab(), '2027-03-10').f1!.prazo).toBe('2027-03-10');
  });
});

describe('agregação por setor e turno', () => {
  const equipe = Array.from({ length: 10 }, (_, i) => colab({ colaboradorId: `c${i}`, salarioBaseCentavos: 200_000 }));
  const d = diagnosticar(equipe, HOJE, R);
  it('soma horas perdidas e converte em FTE', () => {
    const g = d.grupos[0]!;
    expect(d.grupos).toHaveLength(1);
    expect(g).toMatchObject({ colaboradores: 10, afetadosF1: 10, horasPerdidasF1Min: 1200, horasPerdidasF2Min: 2400, fteF2: 1 });
    expect(g.fteF1).toBeCloseTo(1200 / 2520, 2);
    expect(g.deficitPorDiaSemanaF2Min.reduce((a, b) => a + b, 0)).toBeCloseTo(2400, 0);
  });
  it('resume por classificação e folha', () => {
    expect(d.resumo.porClassificacao).toEqual({ adequado: 0, adequacao_f1: 10, adequacao_f2: 0, excecao: 0 });
    expect(d.resumo.folhaMensalCentavos).toBe(2_000_000);
  });
  it('separa grupos por setor e turno', () => {
    const mix = [colab({ colaboradorId: 'a', setor: 'Loja', turno: 'Manhã' }), colab({ colaboradorId: 'b', setor: 'Loja', turno: 'Noite' }), colab({ colaboradorId: 'c', setor: 'Estoque', turno: 'Manhã' })];
    expect(diagnosticar(mix, HOJE, R).grupos).toHaveLength(3);
  });
  it('dias de operação configuráveis', () => {
    const g = diagnosticar(equipe, HOJE, R, { diasOperacao: [1, 2, 3, 4, 5, 6] }).grupos[0]!;
    expect(g.deficitPorDiaSemanaF2Min[0]).toBe(0);
    expect(g.deficitPorDiaSemanaF2Min[1]).toBe(400);
  });
});

describe('invariantes: salário jamais é reduzido', () => {
  it('em todas as combinações, salário novo ≥ atual e valor da hora nunca cai', () => {
    const jornadas: Array<[number, number]> = [[2640, 220], [2520, 210], [2400, 200], [2160, 180], [1800, 150], [2640, 200]];
    const escalas = ['6x1', '5x2', '12x36', 'personalizada'] as const;
    const escol = ['medio', 'superior', null] as const;
    const datas = [HOJE, '2026-12-15', '2027-06-01', '2028-01-10'];
    let n = 0;
    for (const [j, dv] of jornadas) for (const e of escalas) for (const es of escol) for (const sal of [150_000, 2_118_886, 2_118_887, 5_000_000]) for (const ref of datas) {
      const d = diag(colab({ jornadaSemanalMin: j, divisorContrato: dv, tipoEscala: e, escolaridade: es, salarioBaseCentavos: sal }), ref);
      expect(d.salarioNovoCentavos).toBeGreaterThanOrEqual(d.salarioCentavos);
      for (const f of [d.f1, d.f2]) {
        if (!f) continue;
        expect(f.horasAlvoMin).toBeLessThanOrEqual(d.horasAtuaisMin);
        expect(f.horasPerdidasMin).toBeGreaterThanOrEqual(0);
        expect(f.divisor).toBeLessThanOrEqual(d.divisorAtual);
        expect(f.valorHoraCentavos).toBeGreaterThanOrEqual(d.valorHoraAtualCentavos - 1e-9);
      }
      n++;
    }
    expect(n).toBe(6 * 4 * 3 * 4 * 4);
  });
});

describe('desempenho', () => {
  it('diagnostica 200 colaboradores muito abaixo de 1 minuto', () => {
    const equipe = Array.from({ length: 200 }, (_, i) => colab({ colaboradorId: `c${i}`, setor: `S${i % 8}`, turno: i % 2 ? 'Manhã' : 'Noite' }));
    const t = performance.now();
    const d = diagnosticar(equipe, HOJE, R);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(d.resumo.total).toBe(200);
  });
});
