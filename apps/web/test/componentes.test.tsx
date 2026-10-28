import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComparacaoCenarios } from '@/components/ComparacaoCenarios';
import { PainelDiagnostico } from '@/components/PainelDiagnostico';
import { TabelaItens } from '@/components/TabelaItens';
import { cenario, diagnostico } from './fixtures';

const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('PainelDiagnostico', () => {
  const t = html(<PainelDiagnostico diagnostico={diagnostico} />);
  it('mostra datas no formato dd/mm/aaaa e as fases da lei', () => {
    expect(t).toContain('Data de referência 28/10/2026');
    expect(t).toContain('15/12/2026 a 15/12/2027');
    expect(t).toContain('a partir de 15/12/2027');
  });
  it('mostra totais, folha em BRL e déficit', () => {
    expect(t).toContain('40 Colaboradores analisados');
    expect(t).toContain('R$ 180.000,00');
    expect(t).toContain('56h / 112h');
    expect(t).toContain('1,34 / 2,80');
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
