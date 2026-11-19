import { describe, expect, it } from 'vitest';
import { REGRAS_SEED } from '../../rules-engine/src/fixtures/regras';
import { colab } from '../../rules-engine/test/util';
import { diaDaSemana, temBloqueio } from '../../rules-engine/src';
import { adequarEscala, ErroAdequacao, validarTurnosAdequacao, type EntradaEscala, type TurnoAdequacao } from '../src';

const pessoas = (n: number, extra: Parameters<typeof colab>[0] = {}) => Array.from({ length: n }, (_, i) => colab({ colaboradorId: `p${i + 1}`, nome: `Pessoa ${String(i + 1).padStart(2, '0')}`, tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, salarioBaseCentavos: 300_000, admissao: '2020-01-01', desligamento: null, ...extra }));
const ent = (n: number, extra: Partial<EntradaEscala> = {}, inicio = '2027-02-01', fim = '2027-02-28'): EntradaEscala => ({
  escala: { id: 'e', empresaId: 'emp', setorId: null, nome: 'Fev', status: 'rascunho', revisao: 1, versao: 1, inicio, fim },
  regras: REGRAS_SEED, colaboradores: pessoas(n), semContrato: [], alocacoes: [], anteriores: [], ausencias: [], feriados: [], cobertura: [], ...extra,
});
const manha = (minimo: number[]): TurnoAdequacao => ({ id: 'manha', nome: 'Manhã', inicioMin: 480, fimMin: 1020, intervaloMin: 60, minimo });            // 8h líquidas
const tarde = (minimo: number[]): TurnoAdequacao => ({ id: 'tarde', nome: 'Tarde', inicioMin: 840, fimMin: 1380, intervaloMin: 60, minimo });            // 14h–23h, 8h líquidas
const todos = (n: number) => Array(7).fill(n) as number[];
const trabalhando = (r: ReturnType<typeof adequarEscala>, id: string) => r.alocacoes.filter((a) => a.colaboradorId === id && a.tipo === 'trabalho');

describe('adequarEscala', () => {
  it('equipe suficiente: cobertura 100%, ninguém passa de 5 dias por semana e o motor não acha bloqueio', () => {
    const r = adequarEscala(ent(14), { turnos: [manha(todos(5)), tarde(todos(5))] });          // 14 pessoas × 5 dias = 70 ≥ 70 posições por semana
    expect(r.resumo).toMatchObject({ faltaTotal: 0, percentualAtendido: 100, pessoasAlocadas: 14 });
    expect(temBloqueio(r.violacoes)).toBe(false);
    for (const p of r.pessoas) expect(p.diasTrabalhados).toBeLessThanOrEqual(20);              // 4 semanas × 5 dias
    expect(r.cobertura.every((c) => c.alocado >= c.necessario)).toBe(true);
  });

  it('cada pessoa fica sempre no mesmo turno (sem interjornada) e as folgas semanais são respeitadas', () => {
    const r = adequarEscala(ent(14), { turnos: [manha(todos(5)), tarde(todos(5))] });
    for (const c of Object.keys(r.turnoDe)) {
      const horarios = new Set(trabalhando(r, c).map((a) => `${a.inicioMin}-${a.fimMin}`));
      expect(horarios.size).toBe(1);
    }
    expect(r.violacoes.filter((v) => ['FOLGAS_SEMANA', 'INTERJORNADA', 'LIMITE_SEMANAL', 'INTERVALO_INTRAJORNADA'].includes(v.codigo))).toEqual([]);
    // semana completa: no máximo 5 dias de trabalho por pessoa (2 folgas)
    for (const c of Object.keys(r.turnoDe)) {
      const dias = trabalhando(r, c).map((a) => a.data);
      for (const seg of ['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22']) {
        const fimSem = new Date(Date.parse(`${seg}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
        expect(dias.filter((d) => d >= seg && d <= fimSem).length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('equipe curta: mostra exatamente onde falta gente (dia e turno) e avisa', () => {
    const r = adequarEscala(ent(6), { turnos: [manha(todos(5))] });                            // 6 × 5 = 30 posições para 35 necessárias
    expect(r.resumo.faltaTotal).toBeGreaterThan(0);
    expect(r.resumo.percentualAtendido).toBeLessThan(100);
    expect(r.cobertura.some((c) => c.falta > 0)).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/Faltam \d+ posição/);
    expect(r.violacoes.some((v) => v.codigo === 'COBERTURA_MINIMA')).toBe(true);                // o motor concorda
    expect(temBloqueio(r.violacoes.filter((v) => v.codigo !== 'COBERTURA_MINIMA'))).toBe(false);
  });

  it('a cobertura segue o que foi pedido por dia da semana (menos gente no domingo)', () => {
    const domingoMenos = [1, 4, 4, 4, 4, 4, 3];
    const r = adequarEscala(ent(8), { turnos: [manha(domingoMenos)] });
    expect(r.resumo.faltaTotal).toBeLessThanOrEqual(2);
    const noDomingo = r.cobertura.filter((c) => diaDaSemana(c.data) === 0).map((c) => c.alocado);
    const naSegunda = r.cobertura.filter((c) => diaDaSemana(c.data) === 1).map((c) => c.alocado);
    expect(Math.max(...noDomingo)).toBeLessThanOrEqual(Math.min(...naSegunda));
  });

  it('turno longo respeita o teto semanal: 10h líquidas permitem no máximo 4 dias com teto de 44h', () => {
    const longo: TurnoAdequacao = { id: 'longo', nome: 'Longo', inicioMin: 360, fimMin: 1020, intervaloMin: 60, minimo: todos(2) };   // 10h líquidas
    const r = adequarEscala(ent(5), { turnos: [longo] });
    expect(temBloqueio(r.violacoes.filter((v) => v.codigo === 'LIMITE_SEMANAL'))).toBe(false);
    for (const p of r.pessoas) expect(p.horasSemanaMediaMin).toBeLessThanOrEqual(44 * 60);
  });

  it('férias: a pessoa não é escalada nos dias de ausência e a equipe cobre com o resto', () => {
    const e = ent(8, { ausencias: [{ colaboradorId: 'p1', inicio: '2027-02-08', fim: '2027-02-14', tipo: 'ferias' }] });
    const r = adequarEscala(e, { turnos: [manha(todos(5))] });
    expect(r.alocacoes.filter((a) => a.colaboradorId === 'p1' && a.data >= '2027-02-08' && a.data <= '2027-02-14')).toEqual([]);
    expect(r.violacoes.filter((v) => v.codigo === 'TRABALHO_EM_AUSENCIA')).toEqual([]);
  });

  it('admitido no meio do mês só é escalado depois da admissão; desligado, até o desligamento', () => {
    const cs = [...pessoas(6), colab({ colaboradorId: 'novo', nome: 'Novo', tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, salarioBaseCentavos: 300_000, admissao: '2027-02-15', desligamento: null }),
      colab({ colaboradorId: 'saiu', nome: 'Saiu', tipoEscala: '5x2', jornadaSemanalMin: 2400, divisorContrato: 200, salarioBaseCentavos: 300_000, admissao: '2020-01-01', desligamento: '2027-02-10' })];
    const r = adequarEscala(ent(0, { colaboradores: cs }), { turnos: [manha(todos(4))] });
    expect(r.alocacoes.filter((a) => a.colaboradorId === 'novo').every((a) => a.data >= '2027-02-15')).toBe(true);
    expect(r.alocacoes.filter((a) => a.colaboradorId === 'saiu').every((a) => a.data <= '2027-02-10')).toBe(true);
  });

  it('domingos são repartidos: ninguém trabalha todos os domingos do mês quando a equipe permite', () => {
    const r = adequarEscala(ent(9), { turnos: [manha([3, 3, 3, 3, 3, 3, 3])] });
    const doms = r.pessoas.map((p) => p.domingosTrabalhados);
    expect(Math.max(...doms) - Math.min(...doms)).toBeLessThanOrEqual(2);
    expect(Math.max(...doms)).toBeLessThan(4);
    expect(r.violacoes.filter((v) => v.codigo === 'RODIZIO_DOMINGO')).toEqual([]);
  });

  it('é determinístico: mesma entrada, mesma alocação', () => {
    const p = { turnos: [manha(todos(4)), tarde(todos(3))] };
    expect(adequarEscala(ent(10), p).alocacoes).toEqual(adequarEscala(ent(10), p).alocacoes);
  });

  it('dias por semana menor reduz as horas (ex.: 4 dias × 8h = 32h) e nunca passa do que a lei permite', () => {
    const r4 = adequarEscala(ent(8), { turnos: [manha(todos(3))], diasPorSemana: 4 });
    for (const p of r4.pessoas) expect(p.diasTrabalhados).toBeLessThanOrEqual(16);
    const r7 = adequarEscala(ent(8), { turnos: [manha(todos(3))], diasPorSemana: 7 });          // pediu 7: a lei limita (precisa de 2 folgas no 5x2)
    for (const p of r7.pessoas) expect(p.diasTrabalhados).toBeLessThanOrEqual(20);
    expect(temBloqueio(r7.violacoes.filter((v) => v.codigo === 'FOLGAS_SEMANA'))).toBe(false);
  });

  it('desempenho: 50 pessoas, 2 turnos, o mês inteiro em menos de 5 s', () => {
    const t0 = Date.now();
    const r = adequarEscala(ent(50, {}, '2027-03-01', '2027-03-31'), { turnos: [manha(todos(18)), tarde(todos(17))] });
    expect(Date.now() - t0).toBeLessThan(5000); // ~1 s local; o runner do CI é ~2,5× mais lento
    expect(r.resumo.faltaTotal).toBe(0);
  });
});

describe('entradas inválidas', () => {
  it('recusa turno impossível, cobertura mal formada, sem cobertura e equipe vazia', () => {
    const ok = manha(todos(1));
    expect(() => validarTurnosAdequacao([])).toThrow(ErroAdequacao);
    expect(() => validarTurnosAdequacao([{ ...ok, fimMin: 400 }])).toThrow(/terminar depois/);
    expect(() => validarTurnosAdequacao([{ ...ok, intervaloMin: 600 }])).toThrow(/intervalo/);
    expect(() => validarTurnosAdequacao([{ ...ok, minimo: [1, 2] }])).toThrow(/7 números/);
    expect(() => validarTurnosAdequacao([{ ...ok, minimo: [1, 1, 1, 1, 1, 1, -1] }])).toThrow(/7 números/);
    expect(() => validarTurnosAdequacao([manha(todos(0))])).toThrow(/pelo menos um dia/);
    expect(() => validarTurnosAdequacao([ok, ok])).toThrow(/repetidos/);
    expect(() => adequarEscala(ent(0), { turnos: [ok] })).toThrow(/Não há colaboradores/);
  });
});

describe('média semanal', () => {
  it('a carga por semana usa só semanas completas: 5 dias × 8h = 40h, mesmo com pontas no mês', () => {
    const r = adequarEscala(ent(14, {}, '2027-03-01', '2027-03-31'), { turnos: [manha(todos(5)), tarde(todos(5))] });
    for (const p of r.pessoas) expect(p.horasSemanaMediaMin).toBeLessThanOrEqual(2400);
    expect(r.pessoas.every((p) => p.horasSemanaMediaMin >= 2000)).toBe(true);
  });
});

describe('funcionamento, folgas fixas e férias', () => {
  const dom = (r: ReturnType<typeof adequarEscala>, id?: string) => r.alocacoes.filter((a) => a.tipo === 'trabalho' && diaDaSemana(a.data) === 0 && (!id || a.colaboradorId === id));
  it('dia fechado: ninguém é escalado, a folga é de todos e a cobertura dos outros dias fecha', () => {
    const r = adequarEscala(ent(8), { turnos: [manha([0, 4, 4, 4, 4, 4, 4])], diasFuncionamento: [false, true, true, true, true, true, true] });
    expect(dom(r)).toEqual([]);
    expect(r.diasFechados).toEqual(['2027-02-07', '2027-02-14', '2027-02-21', '2027-02-28']);
    expect(r.resumo.faltaTotal).toBe(0);
    expect(r.alocacoes.filter((a) => diaDaSemana(a.data) === 0).every((a) => a.tipo === 'folga')).toBe(true);
    expect(temBloqueio(r.violacoes)).toBe(false);
    for (const p of r.pessoas) expect(p.domingosTrabalhados).toBe(0);
  });

  it('sem informar os dias de funcionamento, dia em que nenhum turno precisa de gente é tratado como fechado', () => {
    const r = adequarEscala(ent(8), { turnos: [manha([0, 4, 4, 4, 4, 4, 0])] });             // fecha sábado e domingo
    expect(r.diasFechados.length).toBe(8);
    expect(r.alocacoes.filter((a) => a.tipo === 'trabalho' && [0, 6].includes(diaDaSemana(a.data)))).toEqual([]);
    expect(r.resumo.faltaTotal).toBe(0);
  });

  it('cobertura pedida em dia fechado é ignorada e avisada', () => {
    const r = adequarEscala(ent(8), { turnos: [manha(todos(3))], diasFuncionamento: [false, true, true, true, true, true, true] });
    expect(dom(r)).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/dia fechado prevalece/);
    expect(r.cobertura.every((c) => diaDaSemana(c.data) !== 0)).toBe(true);
  });

  it('fechar nos feriados: o feriado vira dia fechado e não conta como falta de cobertura', () => {
    const feriados = [{ data: '2027-02-10', nome: 'Feriado local', abrangencia: 'municipal' as const }];
    const r = adequarEscala(ent(8, { feriados }), { turnos: [manha(todos(3))], fecharNosFeriados: true });
    expect(r.diasFechados).toContain('2027-02-10');
    expect(r.alocacoes.filter((a) => a.data === '2027-02-10' && a.tipo === 'trabalho')).toEqual([]);
    expect(r.cobertura.some((c) => c.data === '2027-02-10')).toBe(false);
    expect(r.violacoes.filter((v) => v.codigo === 'COBERTURA_MINIMA' && v.data === '2027-02-10')).toEqual([]);
    const aberto = adequarEscala(ent(8, { feriados }), { turnos: [manha(todos(3))] });
    expect(aberto.diasFechados).not.toContain('2027-02-10');
  });

  it('folga fixa: a pessoa nunca trabalha naquele dia da semana (e a equipe cobre com os outros)', () => {
    const r = adequarEscala(ent(10), { turnos: [manha(todos(4))], folgasFixas: { p1: [6], p2: [6, 0] } });
    for (const id of ['p1', 'p2']) expect(r.alocacoes.filter((a) => a.colaboradorId === id && a.tipo === 'trabalho' && diaDaSemana(a.data) === 6)).toEqual([]);
    expect(dom(r, 'p2')).toEqual([]);
    expect(r.resumo.faltaTotal).toBe(0);
    expect(temBloqueio(r.violacoes)).toBe(false);
  });

  it('férias aparecem no resultado (com os dias dentro do mês) e a pessoa não trabalha nelas', () => {
    const e = ent(8, { ausencias: [{ colaboradorId: 'p2', inicio: '2027-01-25', fim: '2027-02-05', tipo: 'ferias' }, { colaboradorId: 'p3', inicio: '2027-02-20', fim: '2027-02-21', tipo: 'afastamento' }, { colaboradorId: 'p4', inicio: '2027-04-01', fim: '2027-04-10', tipo: 'ferias' }] });
    const r = adequarEscala(e, { turnos: [manha(todos(3))] });
    expect(r.ausencias).toEqual([
      expect.objectContaining({ colaboradorId: 'p2', inicio: '2027-02-01', fim: '2027-02-05', tipo: 'ferias', dias: 5 }),
      expect.objectContaining({ colaboradorId: 'p3', tipo: 'afastamento', dias: 2 }),
    ]);
    expect(r.alocacoes.filter((a) => a.colaboradorId === 'p2' && a.data <= '2027-02-05')).toEqual([]);
  });

  it('com poucas pessoas de férias a cobertura cai e o resultado mostra exatamente onde', () => {
    const ausencias = ['p1', 'p2', 'p3'].map((id) => ({ colaboradorId: id, inicio: '2027-02-08', fim: '2027-02-14', tipo: 'ferias' as const }));
    const r = adequarEscala(ent(8, { ausencias }), { turnos: [manha(todos(5))] });
    const semana = r.cobertura.filter((c) => c.data >= '2027-02-08' && c.data <= '2027-02-14');
    expect(semana.every((c) => c.falta > 0)).toBe(true);
    expect(r.cobertura.filter((c) => c.data < '2027-02-08' && c.falta > 0).length).toBeLessThanOrEqual(r.cobertura.length);
  });
});


describe('cobertura por faixa de horário', () => {
  // Manhã 08–17 e Tarde 14–23 (intervalo 1h): faixas 08–14 (só a manhã), 14–17 (as duas) e 17–23 (só a tarde)
  const faixas = (a: number[], b: number[], c: number[]) => [
    { id: 'f1', inicioMin: 480, fimMin: 840, minimo: a }, { id: 'f2', inicioMin: 840, fimMin: 1020, minimo: b }, { id: 'f3', inicioMin: 1020, fimMin: 1380, minimo: c },
  ];
  const zeros = Array(7).fill(0) as number[];
  const turnos = [manha(zeros), tarde(zeros)];

  it('equipe suficiente: cada faixa tem o número pedido de pessoas em todos os dias', () => {
    const r = adequarEscala(ent(16), { turnos, faixas: faixas(todos(3), todos(5), todos(3)) });
    expect(r.resumo.faltaTotal).toBe(0);
    expect(r.cobertura.every((c) => c.faixaInicioMin !== undefined && c.alocado >= c.necessario)).toBe(true);
    expect(temBloqueio(r.violacoes)).toBe(false);
  });

  it('a faixa do meio soma as duas equipes: pedir 6 em 14–17 com 3+3 nos extremos fecha com a equipe certa', () => {
    const r = adequarEscala(ent(16), { turnos, faixas: faixas(todos(3), todos(6), todos(3)) });
    expect(r.resumo.faltaTotal).toBe(0);
    expect(r.cobertura.filter((c) => c.turnoId === 'f2').every((c) => c.alocado >= 6)).toBe(true);
  });

  it('equipe curta: mostra a faixa e o dia em que falta gente e o motor concorda', () => {
    const r = adequarEscala(ent(6), { turnos, faixas: faixas(todos(3), todos(4), todos(3)) });
    expect(r.resumo.faltaTotal).toBeGreaterThan(0);
    const f = r.cobertura.find((c) => c.falta > 0)!;
    expect(['f1', 'f2', 'f3']).toContain(f.turnoId);
    expect(r.violacoes.some((v) => v.codigo === 'COBERTURA_MINIMA')).toBe(true);
    expect(temBloqueio(r.violacoes.filter((v) => v.codigo !== 'COBERTURA_MINIMA'))).toBe(false);
  });

  it('faixa que nenhum turno cobre inteira: avisa e aparece como falta', () => {
    const r = adequarEscala(ent(6), { turnos: [manha(zeros)], faixas: [{ id: 'noite', inicioMin: 1080, fimMin: 1320, minimo: todos(1) }] });
    expect(r.avisos.join(' ')).toMatch(/Nenhum turno cobre toda a faixa 18:00–22:00/);
    expect(r.resumo.percentualAtendido).toBe(0);
  });

  it('turnos parciais cobrem juntos uma faixa longa (08–23 só presente quando há alguém em cada trecho)', () => {
    const r = adequarEscala(ent(16), { turnos, faixas: [{ id: 'dia', inicioMin: 480, fimMin: 1380, minimo: todos(2) }] });
    expect(r.avisos.join(' ')).not.toMatch(/Nenhum turno cobre/);
    expect(r.resumo.faltaTotal).toBe(0);
  });

  it('é determinístico e valida as faixas', () => {
    const p = { turnos, faixas: faixas(todos(3), todos(5), todos(3)) };
    expect(adequarEscala(ent(16), p).alocacoes).toEqual(adequarEscala(ent(16), p).alocacoes);
    expect(() => validarTurnosAdequacao(turnos, [{ id: 'x', inicioMin: 600, fimMin: 500, minimo: todos(1) }])).toThrow(ErroAdequacao);
    expect(() => validarTurnosAdequacao(turnos, [{ id: 'x', inicioMin: 500, fimMin: 600, minimo: zeros }])).toThrow(/pelo menos um dia/);
    expect(() => validarTurnosAdequacao(turnos, [{ id: 'x', inicioMin: 500, fimMin: 600, minimo: [1] }])).toThrow(/7 números/);
  });
});
