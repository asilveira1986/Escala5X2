// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fecharMes = vi.fn();
vi.mock('../app/(app)/empresas/[id]/folha/actions', () => ({ fecharMes }));
const { BotaoFechar } = await import('../app/(app)/empresas/[id]/folha/BotaoFechar');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BotaoFechar', () => {
  it('primeiro fechamento: exige ciência dos avisos e fecha', async () => {
    fecharMes.mockResolvedValue({ ok: true, mensagem: 'Mês fechado.' });
    render(<BotaoFechar empresaId="e" mes="2027-02" reabrir={false} podeFechar />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar o mês' }));
    expect(screen.getByText(/não pode ser editado/)).toBeTruthy();
    const confirmar = screen.getByRole('button', { name: 'Confirmar fechamento' }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    await waitFor(() => expect(fecharMes).toHaveBeenCalledWith('e', '2027-02', ''));
    expect(await screen.findByText('Mês fechado.')).toBeTruthy();
  });
  it('reabrir: exige motivo de pelo menos 5 caracteres', async () => {
    fecharMes.mockResolvedValue({ ok: true, mensagem: 'Mês refechado (versão 2).' });
    render(<BotaoFechar empresaId="e" mes="2027-02" reabrir podeFechar />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar de novo (nova versão)' }));
    fireEvent.click(screen.getByRole('checkbox'));
    const confirmar = screen.getByRole('button', { name: 'Confirmar fechamento' }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo da reabertura/), { target: { value: 'abc' } });
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo da reabertura/), { target: { value: 'Falta confirmada depois' } });
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    await waitFor(() => expect(fecharMes).toHaveBeenCalledWith('e', '2027-02', 'Falta confirmada depois'));
  });
  it('mostra o erro do servidor e mantém o painel aberto', async () => {
    fecharMes.mockResolvedValue({ ok: false, erro: 'Só dá para fechar um mês já encerrado.' });
    render(<BotaoFechar empresaId="e" mes="2027-02" reabrir={false} podeFechar />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar o mês' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar fechamento' }));
    expect(await screen.findByText('Só dá para fechar um mês já encerrado.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar fechamento' })).toBeTruthy();
  });
  it('com bloqueio, o botão fica desligado e explica o motivo', () => {
    render(<BotaoFechar empresaId="e" mes="2027-02" reabrir={false} podeFechar={false} motivoBloqueio="Nenhuma escala publicada cobre este mês." />);
    expect((screen.getByRole('button', { name: 'Fechar o mês' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Nenhuma escala publicada cobre este mês.')).toBeTruthy();
  });
});
