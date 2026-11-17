// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ehErroDeCarga, ErroTela } from '@/components/ErroTela';

const recarregar = vi.fn();
beforeEach(() => { recarregar.mockReset(); sessionStorage.clear(); Object.defineProperty(window, 'location', { value: { reload: recarregar }, writable: true }); });
afterEach(cleanup);

describe('ErroTela', () => {
  it('reconhece erro de carga de código (nova versão no ar)', () => {
    expect(ehErroDeCarga({ name: 'ChunkLoadError', message: 'Loading chunk 123 failed' })).toBe(true);
    expect(ehErroDeCarga({ message: 'Failed to fetch dynamically imported module: /_next/static/x.js' })).toBe(true);
    expect(ehErroDeCarga({ message: 'Cannot read properties of undefined' })).toBe(false);
  });
  it('erro comum: mostra o motivo e os botões, sem recarregar sozinho', () => {
    const reset = vi.fn();
    render(<ErroTela error={Object.assign(new Error('Cannot read properties of undefined'), { digest: 'abc' })} reset={reset} />);
    expect(screen.getByText(/Cannot read properties of undefined · abc/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(reset).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar a página' }));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
  it('erro de carga: recarrega sozinho uma única vez (sem laço)', () => {
    const e = Object.assign(new Error('Loading chunk 9 failed'), { name: 'ChunkLoadError' });
    const { unmount } = render(<ErroTela error={e} reset={() => {}} />);
    expect(recarregar).toHaveBeenCalledTimes(1);
    unmount();
    render(<ErroTela error={e} reset={() => {}} />);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});
