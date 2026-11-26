// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decidirAcesso } from '../lib/acesso';

const signInWithOAuth = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ supabaseNavegador: () => ({ auth: { signInWithOAuth } }) }));
vi.mock('../app/(auth)/login/actions', () => ({ entrarComSenha: vi.fn(), enviarLinkMagico: vi.fn() }));
const { default: Login } = await import('../app/(auth)/login/page');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Login', () => {
  it('mostra e-mail e senha, o Google e o link por e-mail recolhido', () => {
    render(<Login />);
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy();
    expect(screen.getByLabelText('E-mail').getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entrar com Google' })).toBeTruthy();
    expect((screen.getByText(/Prefiro receber um link/).closest('details') as HTMLDetailsElement).open).toBe(false);
  });
  it('mostra e oculta a senha', () => {
    render(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar' }));
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('password');
  });
  it('avisa quando o Google falha', async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: 'x' } });
    render(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }));
    expect(await screen.findByText(/Não foi possível entrar com o Google/)).toBeTruthy();
  });
  it('não há mais verificação em duas etapas: a rota /mfa não existe e ninguém é desviado para ela', () => {
    expect(decidirAcesso({ caminho: '/empresas', autenticado: true })).toBeNull();
  });
});
