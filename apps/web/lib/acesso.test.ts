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

  describe('interruptor de MFA', () => {
    const admin = { ...base, papeis: ['admin'], caminho: '/empresas' };
    it('desligado: admin sem MFA entra direto, e /mfa e /login levam à página inicial', () => {
      expect(decidirAcesso({ ...admin, mfaObrigatorio: false })).toBeNull();
      expect(decidirAcesso({ ...admin, mfaObrigatorio: false, mfaCadastrado: true })).toBeNull();
      expect(decidirAcesso({ ...admin, mfaObrigatorio: false, caminho: '/mfa' })).toBe('/');
      expect(decidirAcesso({ ...admin, mfaObrigatorio: false, caminho: '/login' })).toBe('/');
    });
    it('padrão seguro: não informado ou true continua exigindo', () => {
      expect(decidirAcesso(admin)).toBe('/mfa?etapa=cadastro');
      expect(decidirAcesso({ ...admin, mfaObrigatorio: true })).toBe('/mfa?etapa=cadastro');
      expect(decidirAcesso({ ...admin, mfaObrigatorio: undefined })).toBe('/mfa?etapa=cadastro');
    });
    it('não afeta quem não está logado', () => {
      expect(decidirAcesso({ ...admin, autenticado: false, mfaObrigatorio: false })).toBe('/login');
    });
  });
});
