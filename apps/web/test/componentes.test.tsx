import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComparacaoCenarios } from '@/components/ComparacaoCenarios';
import { PainelDiagnostico } from '@/components/PainelDiagnostico';
import { TabelaItens } from '@/components/TabelaItens';
import { resumoSimples } from '@/lib/resumo';
import { diagnosticar } from '@jc/rules-engine';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';
import { cenario, diagnostico, equipe } from './fixtures';

const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('PainelDiagnostico', () => {
  const t = html(<PainelDiagnostico diagnostico={diagnostico} />);
  it('abre com uma frase em português simples e o primeiro prazo', () => {
    expect(t).toContain('Diagnóstico de 28/10/2026');
    expect(t).toContain('30 de 40 pessoas precisam se adequar');
    expect(t).toContain('O primeiro prazo é 15/12/2026.');
    expect(t).toContain('faltam cerca de 2,8 pessoas em tempo integral');
    expect(t).toContain('Já adequados 25%');
  });
  it('mostra as fases da lei com datas dd/mm/aaaa', () => {
    expect(t).toContain('Fase 1: 15/12/2026 a 15/12/2027, até 42 horas por semana');
    expect(t).toContain('Fase 2: a partir de 15/12/2027, até 40 horas por semana');
  });
  it('mostra a situação das pessoas, a folha em BRL e as horas a cobrir', () => {
    expect(t).toMatch(/10 Já adequados/);
    expect(t).toMatch(/30 Adequar na fase 1 Até 15\/12\/2026/);
    expect(t).toContain('Folha de R$ 180.000,00 por mês');
    expect(t).toContain('56h · 112h');
    expect(t).toContain('1,34 · 2,80');
  });
  it('lista setores ordenados pelo maior déficit na fase 2', () => {
    const ordem = [...t.matchAll(/(Loja|Estoque|Caixa) (Manhã|Tarde) (\d+) (\S+) (\S+)/g)].map((m) => Number(m[5]!.replace('h', '')));
    expect(ordem.length).toBeGreaterThan(2);
    expect([...ordem].sort((a, b) => b - a)).toEqual(ordem);
  });
});

describe('ComparacaoCenarios', () => {
  it('destaca o menor custo anual e sinaliza cenário bloqueado', () => {
    const t = html(<ComparacaoCenarios cenarios={[cenario('Contratar', 'contratar'), cenario('Horas extras', 'horas_extras'), cenario('Cortar salário', 'horas_extras', { fatorSalario: 0.9 })]} />);
    expect(t).toContain('Horas extras Menor custo');
    expect(t).not.toContain('Contratar Menor custo');
    expect(t).toContain('Bloqueado');
    expect(t).toContain('R$ 191.004,24');
  });
  it('sem cenários mostra estado vazio; com um só, não destaca', () => {
    expect(html(<ComparacaoCenarios cenarios={[]} />)).toContain('Nenhum cenário simulado');
    expect(html(<ComparacaoCenarios cenarios={[cenario('Único', 'contratar')]} />)).not.toContain('Menor custo');
  });
});

describe('TabelaItens', () => {
  it('renderiza situação, jornada e valor/hora com formato pt-BR', () => {
    const t = html(<TabelaItens itens={diagnostico.itens} />);
    expect(t).toContain('Adequar na fase 1');
    expect(t).toContain('44h › 42h › 40h');
    expect(t).toContain('R$ 9,55 › R$ 10,50');
    expect(t).toContain('Página 1 de 2');
    expect(t).toContain('40 registros');
  });
});

describe('resumoSimples', () => {
  it('singular quando só uma pessoa precisa se adequar', () => {
    const um = diagnosticar(equipe(2).map((c, i) => (i === 1 ? { ...c, jornadaSemanalMin: 2400, divisorContrato: 200, tipoEscala: '5x2' as const, escolaridade: 'medio' as const, salarioBaseCentavos: 200_000 } : { ...c, jornadaSemanalMin: 2640, tipoEscala: '6x1' as const, escolaridade: 'medio' as const, salarioBaseCentavos: 200_000, divisorContrato: 220 })), '2026-10-28', REGRAS_SEED);
    const r = resumoSimples(um);
    expect(r.titulo).toBe('1 de 2 pessoa precisa se adequar'.replace('pessoa', 'pessoa'));
    expect(r.percentualAdequado).toBe(50);
  });
  it('quando tudo está adequado, diz isso com clareza', () => {
    const ok = diagnosticar(equipe(4).map((c) => ({ ...c, jornadaSemanalMin: 2400, divisorContrato: 200, tipoEscala: '5x2' as const, escolaridade: 'medio' as const, salarioBaseCentavos: 200_000 })), '2026-10-28', REGRAS_SEED);
    const r = resumoSimples(ok);
    expect(r).toMatchObject({ nivel: 'ok', percentualAdequado: 100, primeiroPrazo: null });
    expect(r.titulo).toBe('Tudo certo: ninguém precisa mudar de escala');
  });
  it('só fase 2: o primeiro prazo é o início da fase 2', () => {
    const f2 = diagnosticar(equipe(3).map((c) => ({ ...c, jornadaSemanalMin: 2520, divisorContrato: 210, tipoEscala: '5x2' as const, escolaridade: 'medio' as const, salarioBaseCentavos: 200_000 })), '2026-10-28', REGRAS_SEED);
    expect(resumoSimples(f2).primeiroPrazo).toBe('2027-12-15');
  });
});
