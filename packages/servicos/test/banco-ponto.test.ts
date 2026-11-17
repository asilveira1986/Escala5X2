import { describe, expect, it } from 'vitest';
import { apurarBancoPonto, lancarBancoPonto, type EntradaEscala } from '../src';
import { entrada } from './otimizador-util';

const somar = (d: string, i: number) => new Date(Date.parse(`${d}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
const dia = (c: string, data: string, ini = 480, fim = 1020, inter = 60) => ({ colaboradorId: c, data, tipo: 'trabalho' as const, inicioMin: ini, fimMin: fim, intervaloMin: inter });
const marc = (c: string, data: string, hora: string) => ({ colaborador_id: c, momento: `${data}T${hora}:00-03:00` });
const par = (c: string, data: string, ini = '08:00', fim = '17:00') => [marc(c, data, ini), marc(c, data, fim)];
const D1 = '2027-02-01', D2 = '2027-02-02', D3 = '2027-02-03', D4 = '2027-02-04', SAB = '2027-02-06';
const periodo = { inicio: '2027-02-01', fim: '2027-02-28' };
const ent = (extra: Partial<EntradaEscala> = {}) => entrada({ alocacoes: [D1, D2, D3, D4].map((d) => dia('a', d)), ...extra }, '2027-02-01', '2027-02-28');
const rodar = (marcacoes: ReturnType<typeof marc>[], lancados: string[] = [], e = ent()) => apurarBancoPonto([e], marcacoes, periodo, new Set(lancados));

describe('apurarBancoPonto', () => {
  it('dentro da tolerância e sem divergência: nada a lançar', () => {
    expect(rodar([...par('a', D1), ...par('a', D2, '08:03', '17:04')])).toEqual([]);
  });
  it('atraso vira débito; saída depois do turno vira crédito; cada um com o motivo', () => {
    const r = rodar([...par('a', D1, '08:30'), ...par('a', D2, '08:00', '18:15')]);
    expect(r.map((i) => [i.data, i.minutos])).toEqual([[D1, -30], [D2, 75]]);
    expect(r[0]).toMatchObject({ previstoMin: 480, efetivoMin: 450, jaLancado: false });
    expect(r[0]!.motivo).toMatch(/atraso de 30 min.*−0h30/);
    expect(r[1]!.motivo).toMatch(/75 min além do turno.*\+1h15/);
  });
  it('intervalo marcado (4 marcações): pausa menor que a prevista gera crédito', () => {
    const quatro = [marc('a', D3, '08:00'), marc('a', D3, '12:00'), marc('a', D3, '12:30'), marc('a', D3, '17:00')];
    const r = rodar(quatro);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ data: D3, minutos: 30 });
    expect(r[0]!.motivo).toMatch(/intervalo menor/);
  });
  it('trabalho em dia de folga vira crédito do tempo marcado (menos as pausas)', () => {
    const r = rodar([...par('a', SAB, '08:00', '12:00')]);
    expect(r).toEqual([expect.objectContaining({ data: SAB, minutos: 240, previstoMin: 0, motivo: expect.stringContaining('dia de folga') })]);
  });
  it('dia sem marcação, marcação ímpar e marcação em férias não geram lançamento (decisão da gestão)', () => {
    const comFerias = ent({ ausencias: [{ colaboradorId: 'a', inicio: D4, fim: D4 }] } as Partial<EntradaEscala>);
    const r = rodar([...par('a', D2), marc('a', D3, '08:00'), ...par('a', D4, '08:00', '19:00')], [], comFerias);   // D1 sem marcação, D3 ímpar, D4 em ausência
    expect(r).toEqual([]);
  });
  it('dia já lançado pelo ponto aparece marcado, para não lançar de novo', () => {
    const r = rodar([...par('a', D1, '08:30')], [`a|${D1}`]);
    expect(r).toEqual([expect.objectContaining({ data: D1, jaLancado: true })]);
  });
  it('só conta o período pedido e a mesma escala em duas versões não duplica', () => {
    const r = apurarBancoPonto([ent(), ent()], [...par('a', D1, '08:30')], periodo);
    expect(r).toHaveLength(1);
    expect(apurarBancoPonto([ent()], [...par('a', D1, '08:30')], { inicio: '2027-02-02', fim: '2027-02-28' })).toEqual([]);
  });
});

describe('lancarBancoPonto', () => {
  it('manda os itens ao banco com o motivo como descrição e devolve lançados e recusados', async () => {
    let args: Record<string, unknown> = {};
    const cliente = { rpc: async (n: string, a: Record<string, unknown>) => { args = { n, ...a }; return { data: { lancados: 1, recusados: [{ colaboradorId: 'b', data: D2, motivo: 'Sem acordo' }] }, error: null }; } };
    const r = await lancarBancoPonto(cliente, 'emp', [{ colaboradorId: 'a', data: D1, minutos: -30, motivo: 'Ponto: atraso' }]);
    expect(args).toEqual({ n: 'lancar_banco_horas_ponto', p_empresa: 'emp', p_itens: [{ colaboradorId: 'a', data: D1, minutos: -30, descricao: 'Ponto: atraso' }] });
    expect(r).toEqual({ lancados: 1, recusados: [{ colaboradorId: 'b', data: D2, motivo: 'Sem acordo' }] });
  });
  it('erro do banco sobe como erro de serviço', async () => {
    await expect(lancarBancoPonto({ rpc: async () => ({ data: null, error: { message: 'sem permissão' } }) }, 'e', [])).rejects.toThrow(/sem permissão/);
  });
});
