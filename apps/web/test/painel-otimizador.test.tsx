// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const gerarPropostasAutomaticas = vi.fn(); const lerOtimizacao = vi.fn(); const aplicarProposta = vi.fn(); const cancelarOtimizacao = vi.fn();
vi.mock('../app/(app)/empresas/[id]/escalas/actions', () => ({ gerarPropostasAutomaticas, lerOtimizacao, aplicarProposta, cancelarOtimizacao }));
const { PainelOtimizador } = await import('../app/(app)/empresas/[id]/escalas/[escalaId]/PainelOtimizador');

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const metricas = { faltaCobertura: 0, faltaIdeal: 0, deficitHorasMin: 0, domingosMin: 1, domingosMax: 2, preferenciasNaoAtendidas: 0, custoReais: 5000, mudancasEmRelacaoReferencia: 0, objetivo: 1 };
const concluida = (n = 2) => ({ id: 'o1', status: 'concluida' as const, erro: null, resumo: { status: 'otima' as const, mensagem: null, tempoMs: 10, descartadas: 0, propostas: Array.from({ length: n }, (_, i) => ({ indice: i, status: 'otima' as const, alertas: i, infos: 0, metricas })) } });
const montar = (extra: Partial<Parameters<typeof PainelOtimizador>[0]> = {}) => render(<PainelOtimizador escalaId="e1" inicial={null} bloqueado={false} onAplicada={() => undefined} intervaloMs={10} {...extra} />);

describe('PainelOtimizador', () => {
  it('pede as propostas, acompanha até concluir e mostra as cartas com as métricas', async () => {
    gerarPropostasAutomaticas.mockResolvedValue({ ok: true, id: 'o1' });
    lerOtimizacao.mockResolvedValueOnce({ id: 'o1', status: 'processando', erro: null, resumo: null }).mockResolvedValue(concluida());
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar propostas' }));
    await waitFor(() => expect(gerarPropostasAutomaticas).toHaveBeenCalledWith('e1'));
    expect(await screen.findByText(/Isso leva até cerca de 1 minuto/)).toBeTruthy();
    expect(await screen.findByText('Proposta 1 (a melhor) · ótima')).toBeTruthy();
    expect(screen.getByText('Proposta 2 · ótima')).toBeTruthy();
    expect(screen.getAllByText('Cobertura mínima atendida em todas as faixas')).toHaveLength(2);
    expect(screen.getByText('1 alerta para revisar (feriados trabalhados, por exemplo)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gerar novamente' })).toBeTruthy();
  });

  it('aplica a proposta escolhida e avisa a tela; erro da aplicação aparece sem fechar as propostas', async () => {
    const onAplicada = vi.fn();
    aplicarProposta.mockResolvedValueOnce({ ok: false, erro: 'A escala mudou desde que a proposta foi gerada.' }).mockResolvedValueOnce({ ok: true });
    montar({ inicial: concluida(), onAplicada });
    fireEvent.click(screen.getAllByRole('button', { name: 'Aplicar na grade' })[1]!);
    expect(await screen.findByText('A escala mudou desde que a proposta foi gerada.')).toBeTruthy();
    expect(aplicarProposta).toHaveBeenCalledWith('o1', 1);
    expect(onAplicada).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Aplicar na grade' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Aplicar na grade' })[0]!);
    await waitFor(() => expect(onAplicada).toHaveBeenCalledTimes(1));
    expect(aplicarProposta).toHaveBeenLastCalledWith('o1', 0);
  });

  it('com alterações não salvas na grade, não deixa gerar', () => {
    montar({ bloqueado: true });
    expect((screen.getByRole('button', { name: 'Gerar propostas' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Salve as alterações da grade/)).toBeTruthy();
  });

  it('mostra erros: pedido recusado, geração com erro, inviável e nenhuma proposta válida', async () => {
    gerarPropostasAutomaticas.mockResolvedValue({ ok: false, erro: 'Cadastre ao menos um turno antes de gerar propostas.' });
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar propostas' }));
    expect(await screen.findByText('Cadastre ao menos um turno antes de gerar propostas.')).toBeTruthy();
    cleanup();
    montar({ inicial: { id: 'o', status: 'erro', erro: 'O otimizador demorou mais que o esperado.', resumo: null } });
    expect(screen.getByText('O otimizador demorou mais que o esperado.')).toBeTruthy();
    cleanup();
    montar({ inicial: { id: 'o', status: 'concluida', erro: null, resumo: { status: 'inviavel', mensagem: 'Não existe escala válida.', tempoMs: 1, descartadas: 0, propostas: [] } } });
    expect(screen.getByText('Não existe escala válida.')).toBeTruthy();
    cleanup();
    montar({ inicial: { id: 'o', status: 'concluida', erro: null, resumo: { status: 'viavel', mensagem: null, tempoMs: 1, descartadas: 2, propostas: [] } } });
    expect(screen.getByText(/Nenhuma proposta passou na conferência/)).toBeTruthy();
  });

  it('cancelar interrompe o acompanhamento e libera um novo pedido', async () => {
    cancelarOtimizacao.mockResolvedValue({ ok: true });
    lerOtimizacao.mockResolvedValue({ id: 'o1', status: 'erro', erro: 'Cancelada.', resumo: null });
    montar({ inicial: { id: 'o1', status: 'processando', erro: null, resumo: null }, intervaloMs: 100000 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(cancelarOtimizacao).toHaveBeenCalledWith('o1'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Gerar novamente' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText('Cancelada.')).toBeNull();                       // cancelamento não vira mensagem de erro
  });
});
