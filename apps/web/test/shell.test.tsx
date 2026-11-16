// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '@/components/Shell';

const push = vi.fn();
let caminho = '';
vi.mock('next/navigation', () => ({ usePathname: () => caminho, useRouter: () => ({ push }) }));
vi.mock('@/components/BotaoSair', () => ({ BotaoSair: () => <button>Sair</button> }));

const E1 = '11111111-1111-4111-8111-111111111111', E2 = '22222222-2222-4222-8222-222222222222';
const empresas = [{ id: E1, nome: 'Padaria Sol' }, { id: E2, nome: 'Mercado Lua' }];
const montar = (extra: Partial<React.ComponentProps<typeof Shell>> = {}) => {
  if (!caminho) caminho = `/empresas/${E1}/escalas/turnos`;
  return render(<Shell email="ana@x.com" empresas={empresas} ehGestor temMinhaEscala={false} temCarteira estadoInicial={{ recolhido: false, abertos: [] }} {...extra}><p>conteúdo</p></Shell>);
};

afterEach(() => { cleanup(); push.mockClear(); caminho = ''; document.cookie = 'jc-menu=; max-age=0; path=/'; });

describe('Shell', () => {
  it('abre o grupo da página atual e marca o subitem como atual', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Escalas' }).getAttribute('aria-expanded')).toBe('true');
    const atual = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(atual.map((l) => l.textContent)).toContain('Turnos');
  });

  it('abre e fecha um grupo pelo botão e lembra no cookie', () => {
    montar();
    const equipe = screen.getByRole('button', { name: 'Equipe' });
    expect(equipe.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(equipe);
    expect(equipe.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Colaboradores' })).toBeTruthy();
    expect(decodeURIComponent(document.cookie)).toContain('"equipe"');
  });

  it('recolhe para o modo compacto e expande de volta', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Recolher o menu' }));
    expect(screen.getByRole('button', { name: 'Expandir o menu' })).toBeTruthy();
    expect(screen.queryByText('JornadaCerta')).toBeNull();
    expect(decodeURIComponent(document.cookie)).toContain('"r":1');
    fireEvent.click(screen.getByRole('button', { name: 'Expandir o menu' }));
    expect(screen.getByText('JornadaCerta')).toBeTruthy();
  });

  it('começa recolhido quando o cookie diz que estava recolhido', () => {
    montar({ estadoInicial: { recolhido: true, abertos: [] } });
    expect(screen.getByRole('button', { name: 'Expandir o menu' })).toBeTruthy();
  });

  it('troca de empresa mantendo a seção', () => {
    montar();
    fireEvent.change(screen.getByRole('combobox', { name: 'Trocar de empresa' }), { target: { value: E2 } });
    expect(push).toHaveBeenCalledWith(`/empresas/${E2}/escalas/turnos`);
  });

  it('mostra o caminho (migalhas) com o nome da empresa e a página atual', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: 'Você está em' });
    expect(nav.textContent).toContain('Padaria Sol');
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Turnos');
  });

  it('abre e fecha a gaveta no celular, com Esc', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir o menu' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('colaborador sem gestão: só o menu pessoal, sem seletor de empresa e com atalhos embaixo', () => {
    caminho = '/minha-escala';
    montar({ ehGestor: false, temMinhaEscala: true, temCarteira: false });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Equipe' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Atalhos' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Minha escala/ }).length).toBeGreaterThan(0);
  });
});
