// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EscalaPublicada } from '@/lib/minha-escala';

const darCiencia = vi.fn();
vi.mock('../app/(app)/minha-escala/actions', () => ({ darCiencia }));
const { BlocoEscala } = await import('../app/(app)/minha-escala/BlocoEscala');

const escala = (extra: Partial<EscalaPublicada> = {}): EscalaPublicada => ({
  id: 'e1', nome: 'Fevereiro', versao: 2, publicadaEm: '2027-01-28T12:00:00Z', inicio: '2027-02-01', fim: '2027-02-28', hash: 'abcdef0123456789ffff', cienteEm: null,
  dias: [
    { data: '2027-02-01', tipo: 'trabalho', inicioMin: 480, fimMin: 1020, intervaloMin: 60 },
    { data: '2027-02-02', tipo: 'trabalho', inicioMin: 1320, fimMin: 1800, intervaloMin: 0 },
    { data: '2027-02-06', tipo: 'folga', inicioMin: null, fimMin: null, intervaloMin: 0 },
  ], ...extra,
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Minha escala', () => {
  it('mostra o resumo, o calendário e pede a ciência', () => {
    render(<BlocoEscala e={escala()} hoje="2027-02-01" />);
    expect(screen.getByText(/Fevereiro/)).toBeTruthy();
    expect(screen.getByText('Aguardando sua ciência')).toBeTruthy();
    expect(screen.getByText(/2 dia\(s\) de trabalho · 16h/)).toBeTruthy(); // 8h + 8h líquidas
    expect(screen.getByLabelText('01/02/2027: 08:00 às 17:00 · intervalo de 60 min')).toBeTruthy();
    expect(screen.getByLabelText('02/02/2027: 22:00 às 06:00 (dia seguinte)')).toBeTruthy();
    expect(screen.getByLabelText('06/02/2027: Folga')).toBeTruthy();
    expect(screen.getByLabelText('03/02/2027: sem lançamento')).toBeTruthy();
    expect(screen.getByText(/Código de verificação: abcdef0123456789/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Estou ciente desta escala' })).toBeTruthy();
  });
  it('depois da ciência não oferece o botão e mostra a data', () => {
    render(<BlocoEscala e={escala({ cienteEm: '2027-01-29T09:00:00Z' })} hoje="2027-02-01" />);
    expect(screen.getByText('Ciente em 29/01/2027')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ciente/i })).toBeNull();
  });
  it('registra a ciência e mostra o erro quando falha', async () => {
    darCiencia.mockResolvedValueOnce({ ok: false, erro: 'Escala não está publicada.' });
    render(<BlocoEscala e={escala()} hoje="2027-02-01" />);
    fireEvent.click(screen.getByRole('button', { name: 'Estou ciente desta escala' }));
    expect(await screen.findByText('Escala não está publicada.')).toBeTruthy();
    expect(darCiencia).toHaveBeenCalledWith('e1');
    darCiencia.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Estou ciente desta escala' }));
    await waitFor(() => expect(darCiencia).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Escala não está publicada.')).toBeNull());
  });
});
