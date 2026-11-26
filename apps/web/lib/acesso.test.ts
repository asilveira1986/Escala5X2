import { describe, expect, it } from 'vitest';
import { decidirAcesso } from './acesso';

describe('decidirAcesso', () => {
  it('o link de convite (/auth/confirmar) é público para quem ainda não entrou', () => {
    expect(decidirAcesso({ caminho: '/auth/confirmar', autenticado: false })).toBeNull();
    expect(decidirAcesso({ caminho: '/auth/callback', autenticado: false })).toBeNull();
  });
  it('anônimo vai ao login, exceto em rotas públicas', () => {
    expect(decidirAcesso({ autenticado: false, caminho: '/carteira' })).toBe('/login');
    expect(decidirAcesso({ autenticado: false, caminho: '/mfa' })).toBe('/login');
    expect(decidirAcesso({ autenticado: false, caminho: '/login' })).toBeNull();
  });
  it('quem já entrou acessa o app e não volta ao login, qualquer que seja o papel', () => {
    expect(decidirAcesso({ autenticado: true, caminho: '/empresas' })).toBeNull();
    expect(decidirAcesso({ autenticado: true, caminho: '/login' })).toBe('/');
  });
});
