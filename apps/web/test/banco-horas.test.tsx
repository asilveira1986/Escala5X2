// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Lancamento } from '@jc/servicos';
import { calcularSaldo } from '@jc/servicos';

const lancar = vi.fn(); const estornar = vi.fn();
vi.mock('../app/(app)/empresas/[id]/banco-horas/actions', () => ({ lancar, estornar }));
const { FormLancamento } = await import('../app/(app)/empresas/[id]/banco-horas/FormLancamento');
const { Extrato } = await import('../app/(app)/empresas/[id]/banco-horas/Extrato');
const { ResumoSaldo } = await import('../app/(app)/empresas/[id]/banco-horas/Resumo');

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const l = (id: number, data: string, minutos: number, extra: Partial<Lancamento> = {}): Lancamento => ({
  id, colaborador_id: 'a', data, minutos, origem: minutos > 0 ? 'manual' : 'compensacao', descricao: null, vence_em: minutos > 0 ? '2027-08-01' : null, estorna_id: null, criado_em: '', ...extra,
});

describe('FormLancamento', () => {
  it('lança um crédito com a duração digitada e o sinal do tipo', async () => {
    lancar.mockResolvedValue({ ok: true, mensagem: 'Lançamento registrado.' });
    render(<FormLancamento empresaId="e" colaboradorId="c" hoje="2027-03-01" vencidoMin={0} />);
    fireEvent.change(screen.getByLabelText(/^Duração/), { target: { value: '02:30' } });
    fireEvent.change(screen.getByLabelText(/Descrição/), { target: { value: 'Inventário' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(lancar).toHaveBeenCalledWith({ empresaId: 'e', colaboradorId: 'c', tipo: 'manual', sinal: 1, data: '2027-03-01', duracao: '02:30', descricao: 'Inventário' }));
    expect(await screen.findByText('Lançamento registrado.')).toBeTruthy();
    expect((screen.getByLabelText(/^Duração/) as HTMLInputElement).value).toBe('');
  });
  it('débito usa sinal negativo; pagamento sugere quitar o vencido; erro do servidor aparece', async () => {
    lancar.mockResolvedValue({ ok: false, erro: 'O saldo ficaria abaixo do permitido.' });
    render(<FormLancamento empresaId="e" colaboradorId="c" hoje="2027-03-01" vencidoMin={135} />);
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: '3' } });           // Pagamento de horas vencidas
    expect((screen.getByLabelText(/^Duração/) as HTMLInputElement).value).toBe('02:15');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(lancar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'pagamento', sinal: -1, duracao: '02:15' })));
    expect(await screen.findByText('O saldo ficaria abaixo do permitido.')).toBeTruthy();
  });
  it('pagamento sem horas vencidas avisa', () => {
    render(<FormLancamento empresaId="e" colaboradorId="c" hoje="2027-03-01" vencidoMin={0} />);
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: '3' } });
    expect(screen.getByText('Não há horas vencidas a pagar.')).toBeTruthy();
  });
});

describe('Extrato', () => {
  const ls = [l(1, '2027-02-01', 120), l(2, '2027-02-05', -60), l(3, '2027-02-06', -120, { origem: 'estorno', estorna_id: 1, vence_em: null })];
  it('RH: mostra os lançamentos do mais novo ao mais antigo, marca estornado e permite estornar com motivo', async () => {
    estornar.mockResolvedValue({ ok: true, mensagem: 'Lançamento estornado.' });
    render(<Extrato lancamentos={ls} empresaId="e" />);
    const linhas = screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(linhas[0]).toContain('06/02/2027');
    expect(linhas[2]).toContain('01/02/2027');
    expect(screen.getByText('estornado')).toBeTruthy();                                    // o crédito 1 já foi estornado
    expect(screen.getAllByRole('button', { name: /Estornar lançamento/ })).toHaveLength(1);   // só o débito 2: o crédito já estornado e o estorno não têm botão
    fireEvent.click(screen.getByRole('button', { name: /Estornar lançamento de 1h em 05\/02\/2027/ }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar estorno' }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo do estorno/), { target: { value: 'Lançado em duplicidade' } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(estornar).toHaveBeenCalledWith('e', 2, 'Lançado em duplicidade'));
    expect(await screen.findByText('Lançamento estornado.')).toBeTruthy();
  });
  it('colaborador: somente leitura, sem botões', () => {
    render(<Extrato lancamentos={ls} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('+2h')).toBeTruthy();
  });
});

describe('ResumoSaldo', () => {
  it('mostra saldo, a vencer, vencido, valor estimado e lotes', () => {
    const s = calcularSaldo([l(1, '2026-08-01', 120, { vence_em: '2027-02-01' }), l(2, '2026-12-01', 60, { vence_em: '2027-03-15' }), l(3, '2027-01-01', 180, { vence_em: '2027-07-01' })], '2027-03-01');
    const html = renderToStaticMarkup(<ResumoSaldo saldo={s} valorVencido={4500} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('Saldo +6h');
    expect(html).toContain('Vence em 30 dias 1h');
    expect(html).toContain('Vencido a pagar 2h');
    expect(html).toContain('≈ R$ 45,00 com adicional');
    expect(html).toContain('Próximo vencimento 15/03/2027');
    expect(html).toContain('3h · vence em 01/07/2027');
  });
  it('saldo negativo permitido pelo acordo aparece destacado', () => {
    const s = calcularSaldo([l(1, '2027-01-01', -90, { origem: 'ajuste' })], '2027-03-01');
    const html = renderToStaticMarkup(<ResumoSaldo saldo={s} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('Saldo −1h30');
    expect(html).toContain('Saldo negativo permitido pelo acordo: 1h30');
  });
});
