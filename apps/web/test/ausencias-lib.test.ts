import { describe, expect, it } from 'vitest';
import { diasDaAusencia, situacaoAusencia } from '../lib/ausencias';

describe('situação da ausência', () => {
  it('agendada antes do primeiro dia, em andamento do primeiro ao último (inclusive) e encerrada depois', () => {
    expect(situacaoAusencia('2026-12-01', '2026-12-10', '2026-11-30')).toBe('agendada');
    expect(situacaoAusencia('2026-12-01', '2026-12-10', '2026-12-01')).toBe('andamento');
    expect(situacaoAusencia('2026-12-01', '2026-12-10', '2026-12-10')).toBe('andamento');
    expect(situacaoAusencia('2026-12-01', '2026-12-10', '2026-12-11')).toBe('encerrada');
  });
  it('conta os dias corridos incluindo o primeiro e o último (também na virada de mês e ano)', () => {
    expect(diasDaAusencia('2026-12-01', '2026-12-01')).toBe(1);
    expect(diasDaAusencia('2026-12-01', '2026-12-10')).toBe(10);
    expect(diasDaAusencia('2026-12-30', '2027-01-02')).toBe(4);
  });
});
