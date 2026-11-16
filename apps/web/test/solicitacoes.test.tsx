// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SolicitacaoLinha } from '@jc/servicos';

const criarPedido = vi.fn(); const responderPedido = vi.fn(); const cancelarPedido = vi.fn(); const aprovarPedido = vi.fn(); const recusarPedido = vi.fn();
vi.mock('../app/(app)/minha-escala/pedidos/actions', () => ({ criarPedido, responderPedido, cancelarPedido }));
vi.mock('../app/(app)/empresas/[id]/solicitacoes/actions', () => ({ aprovarPedido, recusarPedido }));
const { FormPedido } = await import('../app/(app)/minha-escala/pedidos/FormPedido');
const { ListaPedidos } = await import('../app/(app)/minha-escala/pedidos/ListaPedidos');
const { CartaoDecisao } = await import('../app/(app)/empresas/[id]/solicitacoes/CartaoDecisao');

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const sol = (extra: Partial<SolicitacaoLinha> = {}): SolicitacaoLinha => ({
  id: 's1', empresa_id: 'emp', solicitante_id: 'a', destinatario_id: 'b', solicitante_nome: 'Ana', destinatario_nome: 'Bia', tipo: 'troca_turno',
  payload: { escalaId: 'e', dataSolicitante: '2027-02-01', dataColega: '2027-02-01' }, motivo: 'Consulta', status: 'pendente', decisao_motivo: null, criado_em: '2027-01-20T10:00:00Z', ...extra,
});
const escalas = [{
  id: 'e1', nome: 'Fev (versão 1)',
  diasTrabalho: [{ data: '2027-02-01', rotulo: 'seg, 01/02/2027 · 08:00 às 17:00' }, { data: '2027-02-02', rotulo: 'ter, 02/02/2027 · 08:00 às 17:00' }],
  diasFolga: [{ data: '2027-02-06', rotulo: 'sáb, 06/02/2027 · Folga' }],
  colegas: [{ colaborador_id: 'b', nome: 'Bia', data: '2027-02-01', inicio_min: 720, fim_min: 1260, intervalo_min: 60 }],
}];

describe('FormPedido', () => {
  it('troca de turno: escolhe o seu turno e o do colega e envia', async () => {
    criarPedido.mockResolvedValue({ ok: true });
    render(<FormPedido colaboradorId="a" escalas={escalas} hoje="2027-01-20" />);
    fireEvent.change(screen.getByLabelText(/Seu turno que você quer passar/), { target: { value: '2027-02-01' } });
    fireEvent.change(screen.getByLabelText(/Turno do colega que você assume/), { target: { value: 'b|2027-02-01' } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Consulta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(criarPedido).toHaveBeenCalledWith({ tipo: 'troca_turno', colaboradorId: 'a', escalaId: 'e1', dataSolicitante: '2027-02-01', dataColega: '2027-02-01', destinatarioId: 'b', motivo: 'Consulta' }));
    expect(await screen.findByText(/Pedido enviado ao colega/)).toBeTruthy();
  });
  it('não envia com campos faltando e mostra o erro do servidor', async () => {
    criarPedido.mockResolvedValue({ ok: false, erro: 'Esse colega ainda não tem acesso ao aplicativo para aceitar a troca.' });
    render(<FormPedido colaboradorId="a" escalas={escalas} hoje="2027-01-20" />);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByText('Escolha o seu turno e o turno do colega.')).toBeTruthy();
    expect(criarPedido).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Seu turno que você quer passar/), { target: { value: '2027-02-01' } });
    fireEvent.change(screen.getByLabelText(/Turno do colega que você assume/), { target: { value: 'b|2027-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    expect(await screen.findByText(/ainda não tem acesso/)).toBeTruthy();
  });
  it('troca de folga e férias mudam os campos e o payload', async () => {
    criarPedido.mockResolvedValue({ ok: true });
    render(<FormPedido colaboradorId="a" escalas={escalas} hoje="2027-01-20" />);
    fireEvent.change(screen.getByLabelText('O que você quer pedir?'), { target: { value: 'troca_folga' } });
    fireEvent.change(screen.getByLabelText(/Dia em que você quer folgar/), { target: { value: '2027-02-02' } });
    fireEvent.change(screen.getByLabelText(/Dia em que você pode trabalhar/), { target: { value: '2027-02-06' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(criarPedido).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'troca_folga', folgarEm: '2027-02-02', trabalharEm: '2027-02-06' })));
    fireEvent.change(screen.getByLabelText('O que você quer pedir?'), { target: { value: 'ferias' } });
    fireEvent.change(screen.getByLabelText('Primeiro dia'), { target: { value: '2027-03-01' } });
    fireEvent.change(screen.getByLabelText(/Último dia/), { target: { value: '2027-03-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(criarPedido).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: 'ferias', inicio: '2027-03-01', fim: '2027-03-10' })));
    expect(screen.queryByLabelText(/Seu turno/)).toBeNull();
  });
  it('sem escala publicada, troca fica indisponível mas férias continua', () => {
    render(<FormPedido colaboradorId="a" escalas={[]} hoje="2027-01-20" />);
    expect(screen.getByText(/ainda não tem escala publicada/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Enviar pedido' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('O que você quer pedir?'), { target: { value: 'ferias' } });
    expect((screen.getByRole('button', { name: 'Enviar pedido' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ListaPedidos', () => {
  it('meus pedidos: cancelar só nos abertos', async () => {
    cancelarPedido.mockResolvedValue({ ok: true });
    render(<ListaPedidos modo="meus" pedidos={[sol({ status: 'pendente' }), sol({ id: 's2', status: 'aprovada' })]} />);
    expect(screen.getAllByRole('button', { name: /Cancelar pedido/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar pedido/ }));
    await waitFor(() => expect(cancelarPedido).toHaveBeenCalledWith('s1'));
    expect(screen.getByText('Aprovada')).toBeTruthy();
  });
  it('para mim: aceitar ou recusar a troca, com erro visível', async () => {
    responderPedido.mockResolvedValueOnce({ ok: false, erro: 'Este pedido não está mais aguardando a sua resposta.' }).mockResolvedValueOnce({ ok: true });
    render(<ListaPedidos modo="para-mim" pedidos={[sol({ status: 'aguardando_colega' })]} />);
    expect(screen.getByText('Aguardando você')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar a troca de Ana' }));
    expect(await screen.findByText(/não está mais aguardando/)).toBeTruthy();
    expect(responderPedido).toHaveBeenCalledWith('s1', true);
    fireEvent.click(screen.getByRole('button', { name: 'Recusar a troca de Ana' }));
    await waitFor(() => expect(responderPedido).toHaveBeenLastCalledWith('s1', false));
  });
});

describe('CartaoDecisao (RH)', () => {
  const prev = (extra = {}) => ({ resumo: 'x', bloqueios: 0, alertas: 0, problemas: [], conflitos: [], ...extra });
  it('mostra a conferência das regras e aprova', async () => {
    aprovarPedido.mockResolvedValue({ ok: true, mensagem: 'Ana e Bia trocam de turno em 01/02/2027.' });
    render(<ul><CartaoDecisao s={sol()} empresaId="emp" previsao={prev()} /></ul>);
    expect(screen.getByText('A mudança respeita as regras da escala.')).toBeTruthy();
    expect(screen.getByText('Motivo do colaborador: Consulta')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Aprovar:/ }));
    await waitFor(() => expect(aprovarPedido).toHaveBeenCalledWith('emp', 's1'));
    expect((await screen.findAllByText(/trocam de turno/)).length).toBe(2);   // no pedido e na mensagem de sucesso
  });
  it('violação da lei bloqueia a aprovação e mostra a mensagem; recusar continua possível', async () => {
    recusarPedido.mockResolvedValue({ ok: true, mensagem: 'Pedido recusado.' });
    render(<ul><CartaoDecisao s={sol()} empresaId="emp" previsao={prev({ bloqueios: 1, problemas: [{ severidade: 'bloqueio', mensagem: 'Ana: só 9h entre os turnos.' }] })} /></ul>);
    expect(screen.getByText(/Violaria a lei: Ana: só 9h entre os turnos\./)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Aprovar:/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Recusar:/ }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar recusa' }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);                          // exige motivo
    fireEvent.change(screen.getByLabelText(/Motivo da recusa/), { target: { value: 'Intervalo entre jornadas' } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(recusarPedido).toHaveBeenCalledWith('emp', 's1', 'Intervalo entre jornadas'));
    expect(await screen.findByText('Pedido recusado.')).toBeTruthy();
  });
  it('férias com turnos em conflito avisa; pedido encerrado não tem botões', () => {
    render(<ul><CartaoDecisao s={sol({ tipo: 'ferias', payload: { inicio: '2027-02-01', fim: '2027-02-05' }, destinatario_id: null })} empresaId="emp" previsao={prev({ conflitos: ['2027-02-01', '2027-02-02'] })} /></ul>);
    expect(screen.getByText(/2 turno\(s\) já escalado\(s\)/)).toBeTruthy();
    cleanup();
    render(<ul><CartaoDecisao s={sol({ status: 'aprovada', decisao_motivo: null })} empresaId="emp" previsao={null} /></ul>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/nova versão publicada/)).toBeTruthy();
  });
});
