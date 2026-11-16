// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotaoInstalar } from '@/components/BotaoInstalar';
import { BotaoSair } from '@/components/BotaoSair';
import { PwaRegistro } from '@/components/PwaRegistro';
import { hashUsuario } from '@/lib/pwa/uid';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); delete (navigator as unknown as Record<string, unknown>).serviceWorker; });

function falsoServiceWorker() {
  const postMessage = vi.fn();
  const register = vi.fn().mockResolvedValue({});
  const ready = Promise.resolve({ active: { postMessage } });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register, ready, controller: { postMessage } } });
  return { postMessage, register };
}
const alterarOnline = (valor: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => valor });

describe('PwaRegistro', () => {
  beforeEach(() => alterarOnline(true));
  it('registra o service worker e diz a ele quem está usando o aparelho', async () => {
    const sw = falsoServiceWorker();
    render(<PwaRegistro usuario="abc123" />);
    await waitFor(() => expect(sw.register).toHaveBeenCalledWith('/sw.js', { scope: '/' }));
    await waitFor(() => expect(sw.postMessage).toHaveBeenCalledWith({ tipo: 'usuario', id: 'abc123' }));
  });
  it('mostra o aviso quando a conexão cai e o tira quando volta', async () => {
    falsoServiceWorker();
    render(<PwaRegistro usuario="u" />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { alterarOnline(false); window.dispatchEvent(new Event('offline')); });
    expect(await screen.findByText(/Sem conexão: você vê a última versão salva/)).toBeTruthy();
    act(() => { alterarOnline(true); window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
  it('começa avisando se a página abriu já sem conexão', () => {
    falsoServiceWorker(); alterarOnline(false);
    render(<PwaRegistro usuario="u" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
  it('navegador sem service worker: o app continua funcionando', () => {
    expect(() => render(<PwaRegistro usuario="u" />)).not.toThrow();
  });
  it('falha ao registrar não derruba nada', async () => {
    const sw = falsoServiceWorker(); sw.register.mockRejectedValue(new Error('bloqueado'));
    render(<PwaRegistro usuario="u" />);
    await waitFor(() => expect(sw.register).toHaveBeenCalled());
    expect(sw.postMessage).not.toHaveBeenCalled();
  });
});

describe('BotaoSair', () => {
  it('apaga as cópias offline antes de sair', () => {
    const sw = falsoServiceWorker();
    const apagados: string[] = [];
    vi.stubGlobal('caches', { keys: async () => ['jc-paginas-v1', 'jc-meta', 'jc-estatico-v1', 'outro'], delete: async (n: string) => { apagados.push(n); return true; } });
    const { container } = render(<BotaoSair />);
    fireEvent.submit(container.querySelector('form')!);
    expect(sw.postMessage).toHaveBeenCalledWith({ tipo: 'limpar' });
    return waitFor(() => expect(apagados.sort()).toEqual(['jc-meta', 'jc-paginas-v1']));       // o estático (sem dados pessoais) e caches de terceiros ficam
  });
  it('envia o formulário de saída por POST', () => {
    const { container } = render(<BotaoSair />);
    const f = container.querySelector('form')!;
    expect(f.getAttribute('action')).toBe('/auth/sair');
    expect(f.getAttribute('method')?.toLowerCase()).toBe('post');
  });
});

describe('BotaoInstalar', () => {
  const evento = () => Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
  const standalone = (v: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: v && q.includes('standalone'), addEventListener() {}, removeEventListener() {} }));
  const ua = (s: string) => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: s });
  beforeEach(() => { standalone(false); ua('Mozilla/5.0 (Linux; Android 14) Chrome/130'); });

  it('Android/Chrome: aparece com o evento do navegador e instala com um toque', async () => {
    render(<BotaoInstalar />);
    expect(screen.queryByRole('button', { name: 'Instalar' })).toBeNull();
    const e = evento();
    act(() => { window.dispatchEvent(e); });
    fireEvent.click(await screen.findByRole('button', { name: 'Instalar' }));
    await waitFor(() => expect(e.prompt).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Instale o app/)).toBeNull());
  });
  it('iPhone/Safari: mostra a instrução de Adicionar à Tela de Início', () => {
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605');
    render(<BotaoInstalar />);
    expect(screen.getByText(/Adicionar à Tela de Início/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Instalar' })).toBeNull();
  });
  it('iPhone com Chrome (que não instala) não mostra a instrução', () => {
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/130 Safari/605');
    render(<BotaoInstalar />);
    expect(screen.queryByText(/Adicionar à Tela de Início/)).toBeNull();
  });
  it('já instalado (modo standalone): não aparece', () => {
    standalone(true); ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605');
    render(<BotaoInstalar />);
    expect(screen.queryByText(/Adicionar à Tela de Início/)).toBeNull();
  });
  it('"Agora não" some e não volta nas próximas visitas', () => {
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605');
    const { unmount } = render(<BotaoInstalar />);
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(screen.queryByText(/Adicionar à Tela de Início/)).toBeNull();
    unmount();
    render(<BotaoInstalar />);
    expect(screen.queryByText(/Adicionar à Tela de Início/)).toBeNull();
  });
});

describe('hashUsuario', () => {
  it('é estável, curto e diferente por usuário', async () => {
    const a = await hashUsuario('11111111-1111-1111-1111-111111111111');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await hashUsuario('11111111-1111-1111-1111-111111111111')).toBe(a);
    expect(await hashUsuario('22222222-2222-2222-2222-222222222222')).not.toBe(a);
  });
});
