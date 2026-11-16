import { describe, expect, it } from 'vitest';
import { calcularSaldo, lerParametrosBanco, valorEstimadoVencido, type Lancamento } from '../src';

let n = 0;
const l = (data: string, minutos: number, extra: Partial<Lancamento> = {}): Lancamento => ({
  id: ++n, colaborador_id: 'a', data, minutos, origem: minutos > 0 ? 'manual' : 'compensacao', descricao: null,
  vence_em: minutos > 0 ? extra.vence_em ?? null : null, estorna_id: null, criado_em: '', ...extra,
});

describe('calcularSaldo', () => {
  it('sem lançamentos: tudo zero', () => {
    expect(calcularSaldo([], '2027-03-01')).toEqual({ saldoMin: 0, lotes: [], vencidoMin: 0, aVencerMin: 0, proximoVencimento: null, negativoMin: 0 });
  });
  it('créditos: saldo, a vencer na janela, vencido e próximo vencimento', () => {
    const s = calcularSaldo([
      l('2026-08-01', 60, { vence_em: '2027-02-01' }),    // já venceu em 01/03/2027
      l('2026-12-01', 120, { vence_em: '2027-03-15' }),   // vence em 14 dias
      l('2027-01-10', 180, { vence_em: '2027-07-10' }),
    ], '2027-03-01');
    expect(s.saldoMin).toBe(360);
    expect(s.vencidoMin).toBe(60);
    expect(s.aVencerMin).toBe(120);
    expect(s.proximoVencimento).toEqual({ venceEm: '2027-03-15', minutos: 120 });
    expect(s.lotes.map((x) => x.venceEm)).toEqual(['2027-02-01', '2027-03-15', '2027-07-10']);
    expect(calcularSaldo([l('2026-12-01', 120, { vence_em: '2027-03-15' })], '2027-03-01', 7).aVencerMin).toBe(0);   // janela de 7 dias
  });
  it('débito consome primeiro o crédito que vence antes (FIFO por vencimento)', () => {
    const s = calcularSaldo([
      l('2027-01-01', 120, { vence_em: '2027-07-01' }), l('2027-02-01', 120, { vence_em: '2027-06-01' }),
      l('2027-02-10', -90),
    ], '2027-03-01');
    expect(s.lotes).toEqual([{ venceEm: '2027-06-01', minutos: 30 }, { venceEm: '2027-07-01', minutos: 120 }]);
    expect(s.saldoMin).toBe(150);
  });
  it('compensar depois do vencimento não apaga o vencido: ele continua a pagar', () => {
    const s = calcularSaldo([
      l('2026-08-01', 120, { vence_em: '2027-02-01' }),
      l('2027-02-20', -60),                                   // depois do vencimento: só pode consumir crédito ainda válido
      l('2027-01-01', 60, { vence_em: '2027-07-01' }),
    ], '2027-03-01');
    expect(s.vencidoMin).toBe(120);
    expect(s.lotes).toEqual([{ venceEm: '2027-02-01', minutos: 120 }]);        // o crédito válido de janeiro foi usado no débito de fevereiro
    expect(s.saldoMin).toBe(120);
  });
  it('pagamento quita o crédito vencido, começando por ele', () => {
    const s = calcularSaldo([
      l('2026-08-01', 120, { vence_em: '2027-02-01' }), l('2027-01-01', 60, { vence_em: '2027-07-01' }),
      l('2027-03-01', -120, { origem: 'pagamento' }),
    ], '2027-03-01');
    expect(s.vencidoMin).toBe(0);
    expect(s.lotes).toEqual([{ venceEm: '2027-07-01', minutos: 60 }]);
  });
  it('saldo negativo permitido pelo acordo é coberto pelos próximos créditos', () => {
    const s1 = calcularSaldo([l('2027-01-01', 60, { vence_em: '2027-07-01' }), l('2027-01-05', -150)], '2027-03-01');
    expect(s1.saldoMin).toBe(-90);
    expect(s1.negativoMin).toBe(90);
    expect(s1.lotes).toEqual([]);
    const s2 = calcularSaldo([l('2027-01-01', 60, { vence_em: '2027-07-01' }), l('2027-01-05', -150), l('2027-02-01', 200, { vence_em: '2027-08-01' })], '2027-03-01');
    expect(s2.negativoMin).toBe(0);
    expect(s2.lotes).toEqual([{ venceEm: '2027-08-01', minutos: 110 }]);
    expect(s2.saldoMin).toBe(110);
  });
  it('estorno de crédito e de débito se anulam no saldo', () => {
    const credito = l('2027-01-01', 100, { vence_em: '2027-07-01' });
    const est = l('2027-01-02', -100, { origem: 'estorno', estorna_id: credito.id });
    expect(calcularSaldo([credito, est], '2027-03-01')).toMatchObject({ saldoMin: 0, lotes: [], vencidoMin: 0 });
    const deb = l('2027-02-01', -40);
    const base = l('2027-01-01', 100, { vence_em: '2027-07-01' });
    const devolve = l('2027-02-02', 40, { origem: 'estorno', estorna_id: deb.id, vence_em: '2027-08-02' });
    const s = calcularSaldo([base, deb, devolve], '2027-03-01');
    expect(s.saldoMin).toBe(100);
    expect(s.lotes).toEqual([{ venceEm: '2027-07-01', minutos: 60 }, { venceEm: '2027-08-02', minutos: 40 }]);
  });
  it('a ordem de chegada dos lançamentos não importa', () => {
    const a = [l('2027-01-01', 100, { vence_em: '2027-07-01' }), l('2027-02-01', -30), l('2027-02-02', 50, { vence_em: '2027-08-01' })];
    expect(calcularSaldo([...a].reverse(), '2027-03-01')).toEqual(calcularSaldo(a, '2027-03-01'));
  });
  it('invariante: saldo = soma dos lotes − negativo, em muitos cenários aleatórios', () => {
    let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let t = 0; t < 200; t++) {
      const ls: Lancamento[] = [];
      for (let i = 0; i < 12; i++) {
        const dia = `2027-${String(1 + Math.floor(rnd() * 6)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
        const cred = rnd() < 0.55; const m = 15 + Math.floor(rnd() * 200);
        ls.push(l(dia, cred ? m : -m, cred ? { vence_em: `2027-${String(7 + Math.floor(rnd() * 5)).padStart(2, '0')}-15` } : { origem: rnd() < 0.2 ? 'pagamento' : 'compensacao' }));
      }
      const s = calcularSaldo(ls, '2027-09-01');
      expect(s.saldoMin).toBe(s.lotes.reduce((x, y) => x + y.minutos, 0) - s.negativoMin);
      expect(s.lotes.every((x) => x.minutos > 0)).toBe(true);
      expect(s.vencidoMin + s.aVencerMin).toBeLessThanOrEqual(s.lotes.reduce((x, y) => x + y.minutos, 0));
    }
  });
});

describe('valor estimado e parâmetros', () => {
  it('crédito vencido vira hora extra com o adicional', () => {
    expect(valorEstimadoVencido(120, 1500, 50)).toBe(4500);        // 2h × R$15,00 × 1,5
    expect(valorEstimadoVencido(90, 1000, 100)).toBe(3000);
    expect(valorEstimadoVencido(0, 1500, 50)).toBe(0);
  });
  it('lê a cláusula com os padrões do banco de dados', () => {
    expect(lerParametrosBanco(undefined)).toBeNull();
    expect(lerParametrosBanco({})).toEqual({ prazoMeses: 6, limiteSaldoMin: null, limiteNegativoMin: 0 });
    expect(lerParametrosBanco({ prazo_meses: 12, limite_saldo_min: 600, limite_negativo_min: 120, outro: 'x' })).toEqual({ prazoMeses: 12, limiteSaldoMin: 600, limiteNegativoMin: 120 });
    expect(lerParametrosBanco({ prazo_meses: '12' })).toEqual({ prazoMeses: 6, limiteSaldoMin: null, limiteNegativoMin: 0 });   // texto não conta
  });
});
