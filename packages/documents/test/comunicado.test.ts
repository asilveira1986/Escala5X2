import { describe, expect, it } from 'vitest';
import { gerarComunicadosPdf, textoComunicado, type DadosComunicados } from '../src';

const d = (n: number): DadosComunicados => ({
  empresa: { razaoSocial: 'Loja Alfa Ltda', cnpj: '12.345.678/0001-90' }, fase: { rotulo: 'Fase 1', inicio: '2026-12-15', diasTrabalho: 5, diasRepouso: 2 }, geradoEm: '2026-11-17',
  itens: Array.from({ length: n }, (_, i) => ({ nome: `Pessoa ${i}`, setor: i % 2 ? 'Loja' : null, jornadaAtualMin: 2640, novaJornadaMin: 2520 })),
});
const paginas = (pdf: Uint8Array) => (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe('comunicado de adequação de jornada', () => {
  it('o texto traz a data, as jornadas, os dias de trabalho e repouso e a garantia de salário', () => {
    const t = textoComunicado(d(1), d(1).itens[0]!).join(' ');
    expect(t).toContain('a partir de 15/12/2026 (Fase 1)');
    expect(t).toContain('de 44h para 42h');
    expect(t).toContain('5 dias de trabalho e 2 dias de repouso');
    expect(t).toMatch(/não reduz o seu salário/);
  });
  it('minutos quebrados aparecem (42h30)', () => {
    expect(textoComunicado(d(1), { nome: 'A', setor: null, jornadaAtualMin: 2640, novaJornadaMin: 2550 }).join(' ')).toContain('para 42h30');
  });
  it('gera um PDF com uma página por colaborador', async () => {
    const pdf = await gerarComunicadosPdf(d(3));
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
    expect(paginas(pdf)).toBe(3);
  });
});
