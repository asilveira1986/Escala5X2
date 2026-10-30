import { describe, expect, it } from 'vitest';
import { diagnosticar, ErroReducaoSalarial, garantirSemReducao, PARAMETROS_PADRAO, simular, type ParametrosCenario } from '../src';
import { REGRAS_SEED as R } from '../src/fixtures/regras';
import { colab } from './util';

// 10 pessoas, 44h em 6x1, salário R$ 2.000,00; F2: 240 min perdidos cada → 2.400 min/semana → 1,0 FTE
const equipe = Array.from({ length: 10 }, (_, i) => colab({ colaboradorId: `c${i}`, salarioBaseCentavos: 200_000 }));
const diag = diagnosticar(equipe, '2026-10-28', R);
const cen = (p: Partial<ParametrosCenario> & Pick<ParametrosCenario, 'tipo'>): ParametrosCenario => ({ ...PARAMETROS_PADRAO, ...p });

describe('cenários', () => {
  it('contratar: arredonda o FTE para cima e soma encargos e custo único', () => {
    const r = simular(diag, cen({ tipo: 'contratar', encargosPct: 30, custoContratacaoUnicoCentavos: 500_000 }));
    expect(r.contratacoes).toBe(1);
    expect(r.custoMensalCentavos).toBe(260_000);
    expect(r.custoUnicoCentavos).toBe(500_000);
    expect(r.custoAnualCentavos).toBe(260_000 * 12 + 500_000);
  });
  it('contratar na F1 usa o FTE da F1 (0,48 → 1 contratação)', () => {
    expect(simular(diag, cen({ tipo: 'contratar', fase: 'F1' })).contratacoes).toBe(1);
  });
  it('horas extras: déficit × 52/12 × valor da hora × adicional', () => {
    const r = simular(diag, cen({ tipo: 'horas_extras' }));
    // 2.400 min/sem = 40 h/sem → 173,33 h/mês × R$ 10,00 × 1,5
    expect(r.custoMensalCentavos).toBe(260_000);
    expect(r.horasCobertasMensaisMin).toBe(10_400);
    expect(r.alertas.join(' ')).toMatch(/2 horas extras/);
  });
  it('adicional de HE e encargos são editáveis', () => {
    expect(simular(diag, cen({ tipo: 'horas_extras', adicionalHePct: 100, encargosPct: 10 })).custoMensalCentavos).toBe(Math.round((173.3333333 * 1000 * 2 * 1.1)));
  });
  it('reorganizar turnos: a parte absorvida não gera custo', () => {
    expect(simular(diag, cen({ tipo: 'reorganizar_turnos', absorcaoPct: 50 })).custoMensalCentavos).toBe(130_000);
    expect(simular(diag, cen({ tipo: 'reorganizar_turnos', absorcaoPct: 100 })).custoMensalCentavos).toBe(0);
  });
  it('acordo compensatório: custo adicional sobre a folha dos afetados, com alerta jurídico', () => {
    const r = simular(diag, cen({ tipo: 'acordo_compensatorio', custoAdicionalFolhaPct: 5 }));
    expect(r.custoMensalCentavos).toBe(100_000);
    expect(r.alertas.join(' ')).toMatch(/advogado/);
  });
  it('o aumento do valor da hora encarece as horas extras já praticadas', () => {
    const comHe = diagnosticar(equipe.map((c) => ({ ...c, horasExtrasMensaisMin: 600 })), '2026-10-28', R);
    const base = simular(diag, cen({ tipo: 'acordo_compensatorio' }));
    const r = simular(comHe, cen({ tipo: 'acordo_compensatorio' }));
    // 10 pessoas × 10 h × (R$ 10,00 − R$ 9,0909) × 1,5
    expect(r.impactoValorHoraHeCentavos).toBe(Math.round(10 * 10 * (1000 - 200000 / 220) * 1.5));
    expect(r.custoMensalCentavos - base.custoMensalCentavos).toBe(r.impactoValorHoraHeCentavos);
  });
  it('sem déficit, o custo é zero', () => {
    const ok = diagnosticar([colab({ jornadaSemanalMin: 2400, divisorContrato: 200, tipoEscala: '5x2' })], '2026-10-28', R);
    for (const tipo of ['contratar', 'horas_extras', 'reorganizar_turnos'] as const) expect(simular(ok, cen({ tipo })).custoMensalCentavos).toBe(0);
  });
});

describe('irredutibilidade salarial', () => {
  it('bloqueia cenário com redução salarial e alerta', () => {
    const r = simular(diag, cen({ tipo: 'horas_extras', fatorSalario: 0.9 }));
    expect(r.bloqueado).toBe(true);
    expect(r.custoMensalCentavos).toBe(0);
    expect(r.alertas[0]).toMatch(/redução salarial/);
  });
  it('garantirSemReducao lança para qualquer redução e aceita igual ou maior', () => {
    expect(() => garantirSemReducao(100_000, 99_999)).toThrow(ErroReducaoSalarial);
    expect(() => garantirSemReducao(100_000, 100_000)).not.toThrow();
  });
  it('rejeita parâmetros negativos ou absorção acima de 100%', () => {
    expect(() => simular(diag, cen({ tipo: 'horas_extras', encargosPct: -1 }))).toThrow(RangeError);
    expect(() => simular(diag, cen({ tipo: 'reorganizar_turnos', absorcaoPct: 101 }))).toThrow(RangeError);
  });
});
