import { describe, expect, it } from 'vitest';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';
import { colab } from '../../../packages/rules-engine/test/util';
import { diagnosticar } from '@jc/rules-engine';
import { selecionarComunicados } from '@/lib/comunicados';

const antigo = { tipoEscala: '6x1', jornadaSemanalMin: 2640, folgasSemana: 1, salarioBaseCentavos: 300000 } as const;
const equipe = [
  colab({ colaboradorId: 'b', nome: 'Bia', setor: 'Loja', ...antigo }), colab({ colaboradorId: 'a', nome: 'Ana', setor: 'Loja', ...antigo }),
  colab({ colaboradorId: 'c', nome: 'Caio', setor: 'Estoque', ...antigo }),
  colab({ colaboradorId: 'd', nome: 'Duda', setor: 'Estoque', tipoEscala: '5x2', jornadaSemanalMin: 2400, folgasSemana: 2, salarioBaseCentavos: 250000 }),
];
const d = diagnosticar(equipe, '2026-11-17', REGRAS_SEED);

describe('seleção dos comunicados', () => {
  it('fase 1: só quem perde horas, em ordem alfabética, com jornada atual e nova', () => {
    const s = selecionarComunicados(d, REGRAS_SEED, 'F1', null)!;
    expect(s.itens.map((i) => i.nome)).toEqual(['Ana', 'Bia', 'Caio']);
    expect(s.itens[0]).toMatchObject({ jornadaAtualMin: 2640, novaJornadaMin: 2520 });
    expect(s.fase).toEqual({ rotulo: 'Fase 1', inicio: '2026-12-15', diasTrabalho: 5, diasRepouso: 2 });
  });
  it('fase 2 leva a 40h; filtra por setor', () => {
    const s = selecionarComunicados(d, REGRAS_SEED, 'F2', 'Loja')!;
    expect(s.itens.map((i) => [i.nome, i.novaJornadaMin])).toEqual([['Ana', 2400], ['Bia', 2400]]);
    expect(s.fase.inicio).toBe('2027-12-15');
  });
  it('setor sem ninguém a adequar devolve lista vazia; fase sem regra devolve nulo', () => {
    expect(selecionarComunicados(d, REGRAS_SEED, 'F2', 'Inexistente')!.itens).toEqual([]);
    expect(selecionarComunicados(d, REGRAS_SEED.filter((r) => r.codigo !== 'EC141_F2'), 'F2', null)).toBeNull();
  });
});
