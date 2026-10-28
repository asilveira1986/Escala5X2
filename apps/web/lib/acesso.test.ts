import { describe, expect, it } from 'vitest';
import { decidirAcesso } from './acesso';

const base = { autenticado: true, nivelAtual: 'aal1' as const, papeis: ['admin'], mfaCadastrado: false };

describe('decidirAcesso', () => {
  it('anônimo vai ao login, exceto em rotas públicas', () => {
    expect(decidirAcesso({ ...base, autenticado: false, caminho: '/carteira' })).toBe('/login');
    expect(decidirAcesso({ ...base, autenticado: false, caminho: '/login' })).toBeNull();
  });
  it('admin sem MFA cadastrado é levado ao cadastro', () => {
    expect(decidirAcesso({ ...base, caminho: '/empresas' })).toBe('/mfa?etapa=cadastro');
  });
  it('admin com fator cadastrado em aal1 verifica o código', () => {
    expect(decidirAcesso({ ...base, mfaCadastrado: true, caminho: '/empresas' })).toBe('/mfa');
  });
  it('admin em aal2 acessa; não volta ao login', () => {
    expect(decidirAcesso({ ...base, nivelAtual: 'aal2', caminho: '/empresas' })).toBeNull();
    expect(decidirAcesso({ ...base, nivelAtual: 'aal2', caminho: '/login' })).toBe('/');
  });
  it('RH e colaborador não exigem MFA', () => {
    expect(decidirAcesso({ ...base, papeis: ['rh'], caminho: '/empresas' })).toBeNull();
    expect(decidirAcesso({ ...base, papeis: ['colaborador'], caminho: '/empresas' })).toBeNull();
  });
});
