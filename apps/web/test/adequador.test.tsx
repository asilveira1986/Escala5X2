// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const E = '11111111-1111-4111-8111-111111111111', M1 = '22222222-2222-4222-8222-222222222222', ESC = '33333333-3333-4333-8333-333333333333', SETOR = '44444444-4444-4444-8444-444444444444';
const adequar = vi.fn();
vi.mock('@/app/(app)/empresas/[id]/escalas/adequador/actions', () => ({ adequar: (...a: unknown[]) => adequar(...a) }));

const ok = {
  ok: true as const, escalaId: ESC, revisao: 2, criada: true,
  resumo: { necessarioTotal: 280, alocadoTotal: 266, faltaTotal: 14, percentualAtendido: 95, diasComFalta: 7, pessoasAlocadas: 3 },
  avisos: ['Faltam 14 posição(ões) de cobertura no mês com a equipe atual (3 pessoa(s)).'], bloqueios: 0, alertas: 1,
  violacoes: [{ codigo: 'COBERTURA_MINIMA', severidade: 'alerta', quantidade: 7, exemplo: 'Cobertura abaixo do mínimo na faixa 08:00–17:00' }],
  faltas: [{ data: '2027-03-03', turnoId: M1, necessario: 3, alocado: 2, falta: 1 }],
  pessoas: [{ colaboradorId: 'a', nome: 'Ana', turnoId: M1, diasTrabalhados: 20, horasSemanaMediaMin: 2400, domingosTrabalhados: 2, feriadosTrabalhados: 0 }],
  turnos: [{ id: M1, nome: 'Manhã' }],
  grade: { dias: ['2027-03-01', '2027-03-02', '2027-03-07'], linhas: [{ colaboradorId: 'a', nome: 'Ana', celulas: ['0', '0', 'F'] }] },
};
beforeEach(() => adequar.mockReset().mockResolvedValue(ok));
afterEach(cleanup);

const montar = async (props: Record<string, unknown> = {}) => {
  const { Adequador } = await import('@/app/(app)/empresas/[id]/escalas/adequador/Adequador');
  return render(<Adequador empresaId={E} mesPadrao="2027-03" setores={[{ id: SETOR, nome: 'Loja' }]} equipe={10} modelos={[{ id: M1, nome: 'Manhã', inicio: '08:00', fim: '17:00', intervalo: 60 }, { id: '55555555-5555-4555-8555-555555555555', nome: 'Tarde', inicio: '14:00', fim: '23:00', intervalo: 60 }]} {...props} />);
};
const gerar = () => fireEvent.click(screen.getByRole('button', { name: 'Gerar alocação da equipe' }));

describe('Adequador (tela)', () => {
  it('parte dos turnos cadastrados, mostra as horas líquidas e semanais e sugere a cobertura pela equipe', async () => {
    await montar();
    expect(screen.getAllByText(/8h líquidas · 40h\/semana/)).toHaveLength(2);
    expect(screen.getByLabelText('Manhã: pessoas na Seg')).toHaveProperty('value', '3');     // 10 pessoas ÷ 2 turnos × 5 dias ÷ 7 = 3
  });

  it('mudar o horário de um turno cadastrado o torna um turno só da adequação; a cobertura digitada vai no pedido', async () => {
    await montar();
    fireEvent.change(screen.getAllByLabelText('Saída')[0]!, { target: { value: '16:00' } });
    expect(screen.getAllByText(/7h líquidas · 35h\/semana/)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Manhã: pessoas na Dom'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2027-04' } });
    fireEvent.change(screen.getByLabelText('Dias de trabalho por semana'), { target: { value: '6' } });
    gerar();
    await waitFor(() => expect(adequar).toHaveBeenCalled());
    const p = adequar.mock.calls[0]![0];
    expect(p).toMatchObject({ empresaId: E, mes: '2027-04', setorId: null, diasPorSemana: 6 });
    expect(p.turnos[0]).toMatchObject({ nome: 'Manhã', inicio: '08:00', fim: '16:00', intervalo: 60, modeloId: null });      // virou personalizado
    expect(p.turnos[0].minimo[0]).toBe(1);                                                                                   // domingo
    expect(p.turnos[1].modeloId).toBe('55555555-5555-4555-8555-555555555555');                                                // o outro continua ligado ao cadastro
  });

  it('mostra o resultado: cobertura, onde falta gente, a grade, os avisos e o atalho para o editor', async () => {
    await montar();
    gerar();
    expect(await screen.findByText('95%')).toBeTruthy();
    expect(screen.getByText(/14 posição\(ões\) ficam descobertas/)).toBeTruthy();
    expect(screen.getByText(/Cobertura abaixo do mínimo/)).toBeTruthy();
    expect(screen.getByText('2/3')).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(2);
    expect(screen.getByRole('link', { name: 'Abrir no editor de escalas' }).getAttribute('href')).toBe(`/empresas/${E}/escalas/${ESC}`);
  });

  it('erro da ação aparece na tela; sem cobertura ou sem equipe não deixa gerar', async () => {
    adequar.mockResolvedValue({ ok: false, erro: 'Informe quantas pessoas cada turno precisa em pelo menos um dia da semana.' });
    await montar();
    gerar();
    expect(await screen.findByText(/Informe quantas pessoas/)).toBeTruthy();
    cleanup();
    await montar({ equipe: 0 });
    expect((screen.getByRole('button', { name: 'Gerar alocação da equipe' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/cadastre a equipe primeiro/)).toBeTruthy();
  });

  it('adicionar e remover turno; horário inválido bloqueia', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar turno' }));
    expect(screen.getAllByRole('button', { name: /^Remover o turno/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Remover o turno Turno 3' }));
    expect(screen.getAllByRole('button', { name: /^Remover o turno/ })).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText('Saída')[0]!, { target: { value: '09:00' } });
    fireEvent.change(screen.getAllByLabelText('Intervalo (min)')[0]!, { target: { value: '240' } });          // 1h de turno com 4h de intervalo
    expect(screen.getByText(/Confira os horários/)).toBeTruthy();
  });
});
