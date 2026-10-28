import { describe, expect, it } from 'vitest';
import { divisorEfetivo, ErroRegras, resolverRegras, type Regra } from '../src';
import { REGRAS_SEED as R } from '../src/fixtures/regras';
import { acordo, colab } from './util';

describe('vigência das fases (virada de 14/12 para 15/12/2026)', () => {
  it.each([
    ['2026-10-28', 2640, 1, 220, ['LEGADO_44H']],
    ['2026-12-14', 2640, 1, 220, ['LEGADO_44H']],
    ['2026-12-15', 2520, 2, 210, ['EC141_F1']],
    ['2027-12-14', 2520, 2, 210, ['EC141_F1']],
    ['2027-12-15', 2400, 2, 200, ['EC141_F2']],
    ['2030-01-01', 2400, 2, 200, ['EC141_F2']],
  ] as const)('em %s: teto %i min, %i folgas, divisor %i', (data, teto, folgas, divisor, aplicadas) => {
    const e = resolverRegras(colab(), data, R);
    expect(e.maxSemanalMin).toBe(teto);
    expect(e.folgasPorSemana).toBe(folgas);
    expect(e.divisor).toBe(divisor);
    expect(e.regrasAplicadas).toEqual(aplicadas);
    expect(e.interjornadaMin).toBe(660);
    expect(e.maxHoraExtraDiaMin).toBe(120);
  });
});

describe('terceirizada pública', () => {
  const c = colab({ empresa: { porte: 'grande', terceirizadaPublica: true } });
  it('mantém o legado até o prazo (16/10/2027, exclusivo) e rastreia as regras', () => {
    const e = resolverRegras(c, '2027-10-15', R);
    expect(e.maxSemanalMin).toBe(2640);
    expect(e.folgasPorSemana).toBe(1);
    expect(e.regrasAplicadas).toEqual(['EC141_F1', 'EC141_TERC_PUBLICO']);
  });
  it('a partir de 16/10/2027 vale a fase 1 geral', () => {
    const e = resolverRegras(c, '2027-10-16', R);
    expect(e.maxSemanalMin).toBe(2520);
    expect(e.regrasAplicadas).toEqual(['EC141_F1']);
  });
  it('empresa comum não é afetada', () => {
    expect(resolverRegras(colab(), '2027-10-15', R).maxSemanalMin).toBe(2520);
  });
});

describe('alta renda', () => {
  const sup = (sal: number, extra = {}) => colab({ escolaridade: 'superior', salarioBaseCentavos: sal, tipoEscala: '5x2', ...extra });
  it('no limite exato do salário aplica; um centavo abaixo não', () => {
    expect(resolverRegras(sup(2_118_887), '2026-12-15', R).regrasAplicadas).toContain('EC141_ALTA_RENDA');
    expect(resolverRegras(sup(2_118_886), '2026-12-15', R).regrasAplicadas).not.toContain('EC141_ALTA_RENDA');
  });
  it('exige diploma superior', () => {
    expect(resolverRegras(sup(3_000_000, { escolaridade: 'medio' }), '2026-12-15', R).regrasAplicadas).not.toContain('EC141_ALTA_RENDA');
    expect(resolverRegras(sup(3_000_000, { escolaridade: 'pos' }), '2026-12-15', R).regrasAplicadas).toContain('EC141_ALTA_RENDA');
    expect(resolverRegras(sup(3_000_000, { escolaridade: null }), '2026-12-15', R).regrasAplicadas).not.toContain('EC141_ALTA_RENDA');
  });
  it('só vale a partir de 15/12/2026', () => {
    expect(resolverRegras(sup(3_000_000), '2026-12-14', R).regrasAplicadas).toEqual(['LEGADO_44H']);
  });
  it('mantém a jornada contratual acima do teto, com divisor proporcional e 2 folgas', () => {
    const e = resolverRegras(sup(3_000_000, { jornadaSemanalMin: 2640 }), '2027-12-15', R);
    expect(e.maxSemanalMin).toBe(2640);
    expect(e.tetoGeralSemanalMin).toBe(2400);
    expect(e.divisor).toBe(220);
    expect(e.folgasPorSemana).toBe(2);
  });
  it('o piso é parametrizável (sem deploy)', () => {
    const regras = R.map((r) => (r.codigo === 'EC141_ALTA_RENDA' ? { ...r, parametros: { ...r.parametros, salario_minimo: 30000 } } : r));
    expect(resolverRegras(sup(2_500_000), '2026-12-15', regras).regrasAplicadas).not.toContain('EC141_ALTA_RENDA');
  });
});

describe('acordos coletivos', () => {
  const comp = { tipo: 'regime_compensatorio' as const, parametros: { escala: '12x36', max_diaria_min: 720, max_semanal_min: 2520, folgas_semana: 3 } };
  it('regime compensatório vigente altera folgas, jornada diária e teto', () => {
    const e = resolverRegras(colab({ tipoEscala: '12x36', acordos: [acordo('2026-01-01', '2028-01-01', [comp])] }), '2027-03-01', R);
    expect(e.regimeCompensatorio).toEqual({ escala: '12x36', maxDiariaMin: 720 });
    expect(e.maxSemanalMin).toBe(2520);
    expect(e.folgasPorSemana).toBe(3);
    expect(e.regrasAplicadas).toContain('EC141_ACORDO_COMP');
  });
  it('acordo vencido (fim exclusivo) não se aplica', () => {
    const c = colab({ acordos: [acordo('2026-01-01', '2027-03-01', [comp])] });
    expect(resolverRegras(c, '2027-02-28', R).regimeCompensatorio).toBeDefined();
    expect(resolverRegras(c, '2027-03-01', R).regimeCompensatorio).toBeUndefined();
  });
  it.each(['rascunho', 'revisado', 'expirado'] as const)('acordo com status %s não se aplica', (status) => {
    const c = colab({ acordos: [acordo('2026-01-01', null, [comp], status)] });
    expect(resolverRegras(c, '2027-03-01', R).regimeCompensatorio).toBeUndefined();
  });
  it('regra EC141_ACORDO_COMP desativada desliga a exceção', () => {
    const regras = R.map((r) => (r.codigo === 'EC141_ACORDO_COMP' ? { ...r, ativa: false } : r));
    expect(resolverRegras(colab({ acordos: [acordo(null, null, [comp])] }), '2027-03-01', regras).regimeCompensatorio).toBeUndefined();
  });
  it('jornada diária estendida respeita o teto semanal e só vale na transição', () => {
    const c = colab({ acordos: [acordo(null, null, [{ tipo: 'jornada_diaria_estendida', parametros: { max_diaria_min: 600 } }])] });
    const f1 = resolverRegras(c, '2027-06-01', R);
    expect(f1.maxDiariaMin).toBe(600);
    expect(f1.maxSemanalMin).toBe(2520);
    expect(resolverRegras(c, '2027-12-15', R).maxDiariaMin).toBe(480);
  });
  it('adicional de hora extra: vale o maior entre a lei e o acordo', () => {
    const mk = (pct: number) => colab({ acordos: [acordo(null, null, [{ tipo: 'adicional_he', parametros: { percentual: pct } }])] });
    expect(resolverRegras(mk(60), '2027-06-01', R).adicionalHePercentual).toBe(60);
    expect(resolverRegras(mk(40), '2027-06-01', R).adicionalHePercentual).toBe(50);
  });
  it('rodízio de domingo e banco de horas vêm das cláusulas', () => {
    const c = colab({ acordos: [acordo(null, null, [
      { tipo: 'rodizio_domingo', parametros: { a_cada_n_semanas: 3 } },
      { tipo: 'banco_horas', parametros: { prazo_meses: 6 } }])] });
    const e = resolverRegras(c, '2027-06-01', R);
    expect(e.domingoRodizio).toEqual({ aCadaNSemanas: 3 });
    expect(e.bancoHoras).toEqual({ prazo_meses: 6 });
  });
});

describe('mescla e robustez', () => {
  it('regra inativa de porte (placeholder) não muda nada; ativada, a mais específica vence', () => {
    const me = colab({ empresa: { porte: 'me', terceirizadaPublica: false } });
    expect(resolverRegras(me, '2027-06-01', R).maxSemanalMin).toBe(2520);
    const regras = R.map((r) => (r.codigo === 'EC141_PEQUENA_EMPRESA'
      ? { ...r, ativa: true, parametros: { max_semanal_min: 2640, folgas_semana: 1, divisor: 220 } } : r));
    const e = resolverRegras(me, '2027-06-01', regras);
    expect(e.maxSemanalMin).toBe(2640);
    expect(e.regrasAplicadas).toEqual(['EC141_F1', 'EC141_PEQUENA_EMPRESA']);
    expect(resolverRegras(colab(), '2027-06-01', regras).maxSemanalMin).toBe(2520); // médio: fora do escopo
  });
  it('escopo com chave desconhecida desliga a regra (falha segura)', () => {
    const regras: Regra[] = R.map((r) => (r.codigo === 'EC141_F1' ? { ...r, escopo: { regiao: 'sul' } } : r));
    expect(() => resolverRegras(colab(), '2027-06-01', regras)).toThrow(ErroRegras);
  });
  it('falha quando não há regra vigente ou falta parâmetro', () => {
    expect(() => resolverRegras(colab(), '1960-01-01', R)).toThrow(/Nenhuma regra geral/);
    const sem = R.map((r) => (r.codigo === 'EC141_F1' ? { ...r, parametros: { ...r.parametros, divisor: undefined } } : r));
    expect(() => resolverRegras(colab(), '2027-06-01', sem as Regra[])).toThrow(/divisor/);
  });
  it('divisor efetivo é o do contrato quando menor, nunca maior', () => {
    const e = resolverRegras(colab(), '2027-12-15', R);
    expect(divisorEfetivo(e, colab({ divisorContrato: 180 }))).toBe(180);
    expect(divisorEfetivo(e, colab({ divisorContrato: 220 }))).toBe(200);
  });
});
