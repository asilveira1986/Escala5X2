import { describe, expect, it } from 'vitest';
import { descreverMetricas, rotuloProposta } from './otimizador-ui';

const base = { faltaCobertura: 0, faltaIdeal: 0, deficitHorasMin: 0, domingosMin: 2, domingosMax: 2, preferenciasNaoAtendidas: 0, custoReais: 123456, mudancasEmRelacaoReferencia: 0, objetivo: 1 };

describe('apresentação das propostas', () => {
  it('proposta perfeita: tudo ok, custo formatado em reais', () => {
    const l = descreverMetricas(base, 0);
    expect(l.map((x) => x.tom)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(l[0]!.texto).toBe('Cobertura mínima atendida em todas as faixas');
    expect(l[2]!.texto).toBe('Domingos e feriados: 2 por pessoa');
    expect(l[3]!.texto).toBe('Custo estimado do período: R$ 123.456');
  });
  it('mostra o que falta, com singular e plural', () => {
    const l = descreverMetricas({ ...base, faltaCobertura: 1, faltaIdeal: 3, deficitHorasMin: 150, domingosMin: 1, domingosMax: 4, preferenciasNaoAtendidas: 1 }, 2).map((x) => x.texto);
    expect(l).toContain('Falta cobertura: 1 vaga abaixo do mínimo');
    expect(l).toContain('Faltam 2h30 para fechar as horas contratadas');
    expect(l).toContain('Domingos e feriados por pessoa: de 1 a 4');
    expect(l).toContain('3 vagas abaixo da cobertura ideal');
    expect(l).toContain('1 preferência não atendida');
    expect(l).toContain('2 alertas para revisar (feriados trabalhados, por exemplo)');
    expect(descreverMetricas({ ...base, faltaCobertura: 5 }, 1).map((x) => x.texto)).toContain('Falta cobertura: 5 vagas abaixo do mínimo');
    expect(descreverMetricas(base, 1).map((x) => x.texto)).toContain('1 alerta para revisar (feriados trabalhados, por exemplo)');
  });
  it('domingos desiguais viram atenção só quando a diferença passa de 1', () => {
    expect(descreverMetricas({ ...base, domingosMin: 1, domingosMax: 2 }, 0)[2]!.tom).toBe('ok');
    expect(descreverMetricas({ ...base, domingosMin: 0, domingosMax: 2 }, 0)[2]!.tom).toBe('atencao');
  });
  it('rótulos das propostas', () => {
    expect(rotuloProposta(0, 'otima')).toBe('Proposta 1 (a melhor) · ótima');
    expect(rotuloProposta(2, 'viavel')).toBe('Proposta 3 · viável');
  });
});
