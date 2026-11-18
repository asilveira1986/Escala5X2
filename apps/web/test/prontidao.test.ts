import { describe, expect, it } from 'vitest';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';
import { colab } from '../../../packages/rules-engine/test/util';
import { diagnosticar } from '@jc/rules-engine';
import { compararCustos, resumirProntidao } from '@/lib/prontidao';

const base = { tipoEscala: '6x1', jornadaSemanalMin: 2640, folgasSemana: 1, salarioBaseCentavos: 300000 } as const;
const equipe = [
  ...Array.from({ length: 4 }, (_, i) => colab({ colaboradorId: `l${i}`, nome: `Loja ${i}`, setor: 'Loja', ...base })),
  ...Array.from({ length: 2 }, (_, i) => colab({ colaboradorId: `e${i}`, nome: `Estoque ${i}`, setor: 'Estoque', tipoEscala: '5x2', jornadaSemanalMin: 2400, folgasSemana: 2, salarioBaseCentavos: 250000 })),
];
const d = diagnosticar(equipe, '2026-11-17', REGRAS_SEED);

describe('prontidão para a EC 141', () => {
  it('conta quem já está pronto em cada fase e os dias até cada uma', () => {
    const r = resumirProntidao(d, '2026-11-17');
    expect(r.total).toBe(6);
    expect(r.prontosF1).toBe(2);
    expect(r.prontosF2).toBe(2);
    expect(r.pctF2).toBe(33);
    expect(r.diasF1).toBe(28);                  // 17/11 → 15/12/2026
    expect(r.diasF2).toBe(393);
  });
  it('ordena os setores pelos mais afetados e marca o que já está pronto', () => {
    const r = resumirProntidao(d, '2026-11-17');
    expect(r.setores.map((s) => [s.setor, s.pessoas, s.afetadosF2, s.prontoF2])).toEqual([['Loja', 4, 4, false], ['Estoque', 2, 0, true]]);
    expect(r.setores[0]!.fteF2).toBeGreaterThan(0);
  });
  it('equipe vazia conta como 100% pronta (nada a adequar)', () => {
    expect(resumirProntidao(diagnosticar([], '2026-11-17', REGRAS_SEED), '2026-11-17')).toMatchObject({ total: 0, pctF1: 100, pctF2: 100 });
  });
  it('compara horas extras e contratação por fase e marca a mais barata', () => {
    const l = compararCustos(d, { encargosPct: 0, adicionalHePct: 50, custoContratacaoCentavos: 0 });
    expect(l.map((x) => `${x.fase}:${x.tipo}`)).toEqual(['F1:horas_extras', 'F1:contratar', 'F2:horas_extras', 'F2:contratar']);
    for (const f of ['F1', 'F2']) expect(l.filter((x) => x.fase === f && x.maisBarato)).toHaveLength(1);
    expect(l.find((x) => x.fase === 'F2' && x.tipo === 'contratar')!.resultado.contratacoes).toBeGreaterThan(0);
  });
  it('encargos e custo de contratação encarecem o resultado', () => {
    const a = compararCustos(d, { encargosPct: 0, adicionalHePct: 50, custoContratacaoCentavos: 0 });
    const b = compararCustos(d, { encargosPct: 40, adicionalHePct: 50, custoContratacaoCentavos: 500000 });
    const pick = (l: typeof a) => l.find((x) => x.fase === 'F2' && x.tipo === 'contratar')!.resultado.custoAnualCentavos;
    expect(pick(b)).toBeGreaterThan(pick(a));
  });
  it('sem horas a cobrir, ninguém é marcado como mais barato', () => {
    const ok = diagnosticar(equipe.slice(4), '2026-11-17', REGRAS_SEED);
    expect(compararCustos(ok, { encargosPct: 0, adicionalHePct: 50, custoContratacaoCentavos: 0 }).some((x) => x.maisBarato)).toBe(false);
  });
});
