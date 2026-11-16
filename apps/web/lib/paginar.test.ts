import { describe, expect, it } from 'vitest';
import { todasAsLinhas } from './paginar';

const base = (n: number, falhaEm?: number) => async (de: number, ate: number) => {
  if (falhaEm !== undefined && de >= falhaEm) return { data: null, error: { message: 'x' } };
  return { data: Array.from({ length: Math.max(0, Math.min(ate, n - 1) - de + 1) }, (_, i) => de + i), error: null };
};

describe('todasAsLinhas', () => {
  it('lê todas as páginas, na ordem, mesmo acima do limite de 1000 por consulta', async () => {
    const r = await todasAsLinhas<number>(base(2500));
    expect(r.linhas).toHaveLength(2500);
    expect(r.linhas[0]).toBe(0); expect(r.linhas.at(-1)).toBe(2499);
    expect(r).toMatchObject({ truncado: false, erro: false });
  });
  it('quantidade exata múltipla do tamanho termina na página vazia seguinte', async () => {
    expect((await todasAsLinhas<number>(base(2000))).linhas).toHaveLength(2000);
    expect((await todasAsLinhas<number>(base(0))).linhas).toEqual([]);
    expect((await todasAsLinhas<number>(base(1))).linhas).toEqual([0]);
  });
  it('respeita o máximo e avisa que truncou', async () => {
    const r = await todasAsLinhas<number>(base(10_000), { tamanho: 500, maximo: 1500 });
    expect(r.linhas).toHaveLength(1500);
    expect(r.truncado).toBe(true);
  });
  it('erro no meio: devolve o que leu e sinaliza o erro', async () => {
    const r = await todasAsLinhas<number>(base(5000, 2000));
    expect(r.linhas).toHaveLength(2000);
    expect(r.erro).toBe(true);
  });
});
