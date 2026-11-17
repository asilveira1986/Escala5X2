// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeletorCbo } from '@/components/SeletorCbo';

afterEach(cleanup);
const montar = (props = {}) => render(<form><SeletorCbo {...props} /></form>);
const valor = () => (document.querySelector('input[name="cbo"]') as HTMLInputElement).value;
const digitar = async (t: string) => { const c = screen.getByRole('combobox'); fireEvent.change(c, { target: { value: t } }); return c; };

describe('SeletorCbo', () => {
  it('busca por nome, escolhe com o clique e envia só o código', async () => {
    const aoEscolher = vi.fn();
    montar({ aoEscolher });
    await digitar('assistente administrativo');
    const op = await screen.findByRole('option', { name: /4110-10/ });
    fireEvent.mouseDown(op);
    expect(valor()).toBe('4110-10');
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('4110-10 · Assistente administrativo');
    expect(aoEscolher).toHaveBeenCalledWith(['4110-10', 'Assistente administrativo']);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('funciona pelo teclado (setas e Enter) e Esc fecha a lista', async () => {
    montar();
    const c = await digitar('4110');
    await screen.findAllByRole('option');
    fireEvent.keyDown(c, { key: 'ArrowDown' });
    fireEvent.keyDown(c, { key: 'Enter' });
    expect(valor()).toMatch(/^4110-\d\d$/);
    fireEvent.change(c, { target: { value: 'faxineiro' } });
    await screen.findAllByRole('option');
    fireEvent.keyDown(c, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('digitar de novo invalida a escolha anterior; o botão × limpa', async () => {
    montar({ valorInicial: '411010' });
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('4110-10 · Assistente administrativo'));
    expect(valor()).toBe('4110-10');
    fireEvent.click(screen.getByRole('button', { name: 'Limpar a ocupação' }));
    expect(valor()).toBe('');
    const c = await digitar('padeiro');
    expect(valor()).toBe('');
    await screen.findAllByRole('option');
    expect(c.getAttribute('aria-expanded')).toBe('true');
  });
  it('avisa quando nada é encontrado', async () => {
    montar();
    await digitar('zzzzqqq');
    expect(await screen.findByText('Nenhuma ocupação encontrada.')).toBeTruthy();
  });
});
