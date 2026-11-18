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
  it('abre o grupo da página atual (Configurações) e marca o subitem como atual', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('true');
    const atual = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(atual.map((l) => l.textContent)).toContain('Turnos');
  });

  it('submenu dinâmico: só um grupo fica aberto; abrir outro fecha o anterior e clicar no aberto o fecha', () => {
    montar();
    const config = screen.getByRole('button', { name: 'Configurações' });
    const escalas = screen.getByRole('button', { name: 'Escalas' });
    expect(escalas.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(escalas);
    expect(escalas.getAttribute('aria-expanded')).toBe('true');
    expect(config.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('link', { name: 'Gerar escala' })).toBeTruthy();
    fireEvent.click(escalas);
    expect(escalas.getAttribute('aria-expanded')).toBe('false');
  });

  it('Configurações tem o que é da empresa e o que é do sistema, em blocos', () => {
    montar();
    expect(screen.getByText('Desta empresa')).toBeTruthy();
    expect(screen.getByText('Do sistema')).toBeTruthy();
    for (const l of ['Turnos', 'Cobertura mínima', 'Importar planilha', 'Empresas', 'Plano e cobrança']) expect(screen.getByRole('link', { name: l })).toBeTruthy();
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

  it('a barra de cima mostra o caminho até aqui, sem repetir a página (o título dela está no cabeçalho)', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: 'Você está em' });
    expect(nav.textContent).toContain('Padaria Sol');
    expect(nav.textContent).toContain('Configurações');
    expect(nav.textContent).not.toContain('Turnos');
    expect(nav.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('em uma tela de registro (escala aberta) o item da lista aparece como último passo do caminho', () => {
    caminho = `/empresas/${E1}/escalas/33333333-3333-4333-8333-333333333333`;
    montar();
    const nav = screen.getByRole('navigation', { name: 'Você está em' });
    expect(nav.textContent).toContain('Escalas do mês');
  });

  it('a empresa não se repete: o nome aparece no seletor do menu e, no celular, só no caminho', () => {
    montar();
    expect(screen.getByRole('combobox', { name: 'Trocar de empresa' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Você está em' });
    expect(nav.querySelector('li')!.className).toContain('lg:hidden');
    expect(screen.queryByText('Empresa', { selector: 'p' })).toBeNull();          // sem o título de seção "Empresa" em cima do seletor
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

  it('mostra o cabeçalho da página (ícone, título e descrição) nas telas do menu, mas não nas que têm título próprio', () => {
    montar();
    expect(screen.getByRole('heading', { level: 1, name: 'Turnos' })).toBeTruthy();
    expect(screen.getByText('Modelos de horário para pintar na grade.')).toBeTruthy();
    cleanup();
    caminho = `/empresas/${E1}`; // Visão geral desenha o próprio título
    montar();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
