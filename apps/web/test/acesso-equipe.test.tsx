// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const convidar = vi.fn(); const revogarAcesso = vi.fn();
vi.mock('../app/(app)/empresas/[id]/colaboradores/actions', () => ({ convidar, revogarAcesso }));
const { CelulaAcesso } = await import('../app/(app)/empresas/[id]/colaboradores/CelulaAcesso');

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const cel = (acesso: { estado: 'sem' | 'pendente' | 'com'; email?: string }, podeGerir = true) =>
  render(<CelulaAcesso empresaId="emp" colaboradorId="c1" nome="Ana" acesso={acesso} podeGerir={podeGerir} />);

describe('CelulaAcesso', () => {
  it('sem acesso: convida pelo e-mail e mostra a mensagem do servidor', async () => {
    convidar.mockResolvedValue({ ok: true, mensagem: 'Convite enviado para ana@x.com.' });
    cel({ estado: 'sem' });
    expect(screen.getByText('Sem acesso')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Convidar Ana' }));
    const enviar = screen.getByRole('button', { name: 'Enviar convite' }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true); // sem e-mail
    fireEvent.change(screen.getByLabelText('E-mail de Ana'), { target: { value: 'ana@x.com' } });
    fireEvent.click(enviar);
    await waitFor(() => expect(convidar).toHaveBeenCalledWith('emp', 'c1', 'ana@x.com'));
    expect(await screen.findByText('Convite enviado para ana@x.com.')).toBeTruthy();
  });
  it('mostra o erro (ex.: sem permissão) e mantém o formulário', async () => {
    convidar.mockResolvedValue({ ok: false, erro: 'Você não tem permissão para esta ação.' });
    cel({ estado: 'sem' });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar Ana' }));
    fireEvent.change(screen.getByLabelText('E-mail de Ana'), { target: { value: 'ana@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeTruthy();
    expect(screen.getByLabelText('E-mail de Ana')).toBeTruthy();
  });
  it('convite pendente mostra o e-mail e permite reenviar ou cancelar', async () => {
    revogarAcesso.mockResolvedValue({ ok: true, mensagem: 'Acesso removido.' });
    vi.stubGlobal('confirm', () => true);
    cel({ estado: 'pendente', email: 'ana@x.com' });
    expect(screen.getByText('Convite enviado')).toBeTruthy();
    expect(screen.getByText('ana@x.com')).toBeTruthy();
    expect(screen.queryByLabelText('E-mail de Ana')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar convite Ana' }));
    expect((screen.getByLabelText('E-mail de Ana') as HTMLInputElement).value).toBe('ana@x.com'); // já preenchido
    cleanup();
    cel({ estado: 'pendente', email: 'ana@x.com' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar convite de Ana' }));
    await waitFor(() => expect(revogarAcesso).toHaveBeenCalledWith('emp', 'c1'));
    expect(await screen.findByText('Acesso removido.')).toBeTruthy();
  });
  it('com acesso: só remove, e pede confirmação antes', async () => {
    cel({ estado: 'com' });
    expect(screen.getByText('Com acesso')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Convidar/ })).toBeNull();
    vi.stubGlobal('confirm', () => false);
    fireEvent.click(screen.getByRole('button', { name: 'Remover acesso de Ana' }));
    await waitFor(() => expect(revogarAcesso).not.toHaveBeenCalled());
  });
  it('quem não gere a empresa só vê o estado, sem botões', () => {
    cel({ estado: 'sem' }, false);
    expect(screen.getByText('Sem acesso')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
