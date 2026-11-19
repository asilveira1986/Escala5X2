// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const removerDemanda = vi.fn(), removerAusencia = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../app/(app)/empresas/[id]/escalas/cobertura/actions', () => ({ removerDemanda, adicionarDemanda: vi.fn() }));
vi.mock('../app/(app)/empresas/[id]/escalas/ausencias/actions', () => ({ removerAusencia, adicionarAusencia: vi.fn() }));
vi.mock('../app/(app)/empresas/[id]/escalas/actions', () => ({ arquivarModelo: vi.fn(), editarModelo: vi.fn(), criarModelo: vi.fn() }));
const { TabelaEscalas } = await import('../app/(app)/empresas/[id]/escalas/TabelaEscalas');
const { TabelaTurnos } = await import('../app/(app)/empresas/[id]/escalas/turnos/TabelaTurnos');
const { TabelaCobertura } = await import('../app/(app)/empresas/[id]/escalas/cobertura/TabelaCobertura');
const { TabelaAusencias } = await import('../app/(app)/empresas/[id]/escalas/ausencias/TabelaAusencias');
const { TelaFaixa } = await import('../app/(app)/empresas/[id]/escalas/cobertura/[demandaId]/TelaFaixa');
const { TelaAusencia } = await import('../app/(app)/empresas/[id]/escalas/ausencias/[ausenciaId]/TelaAusencia');

beforeEach(() => { push.mockReset(); removerDemanda.mockReset().mockResolvedValue({ ok: 'Faixa removida.' }); removerAusencia.mockReset().mockResolvedValue({}); });
afterEach(() => cleanup());
const cabecalhos = () => screen.getAllByRole('columnheader').map((h) => h.textContent).filter(Boolean);

describe('Escalas do mês', () => {
  const dados = [
    { id: 'e1', nome: 'Loja', versao: 2, periodo: '01/12/2026 a 31/12/2026', status: 'publicada' as const },
    { id: 'e2', nome: 'Caixa', versao: 1, periodo: '01/11/2026 a 30/11/2026', status: 'rascunho' as const },
  ];
  it('mostra escala, período e situação; o nome é link e a linha leva ao editor', () => {
    render(<TabelaEscalas dados={dados} empresaId="emp" />);
    expect(cabecalhos()).toEqual(['Escala', 'Período', 'Situação']);
    expect(screen.getByText('Publicada')).toBeTruthy();
    expect(screen.getByText('Rascunho')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Loja/ }).getAttribute('href')).toBe('/empresas/emp/escalas/e1');
    fireEvent.click(screen.getByText('01/11/2026 a 30/11/2026'));
    expect(push).toHaveBeenCalledWith('/empresas/emp/escalas/e2');
  });
  it('sem escalas mostra a orientação', () => {
    render(<TabelaEscalas dados={[]} empresaId="emp" />);
    expect(screen.getByText(/Crie a primeira com o botão Nova escala/)).toBeTruthy();
  });
});

describe('Turnos', () => {
  it('mostra turno, horário e jornada líquida; a linha leva à tela do turno', () => {
    render(<TabelaTurnos empresaId="emp" dados={[{ id: 't1', nome: 'Manhã', inicio_min: 480, fim_min: 1020, intervalo_min: 60 }, { id: 't2', nome: 'Noite', inicio_min: 1320, fim_min: 1800, intervalo_min: 60 }]} />);
    expect(cabecalhos()).toEqual(['Turno', 'Horário', 'Jornada líquida']);
    expect(screen.getByText('08:00–17:00')).toBeTruthy();
    expect(screen.getByText('22:00–06:00')).toBeTruthy();
    expect(screen.getByText('8h')).toBeTruthy();   // 08:00–17:00 menos 1h de intervalo
    expect(screen.getByText('7h')).toBeTruthy();   // 22:00–06:00 (8h) menos 1h de intervalo
    expect(screen.getByRole('link', { name: 'Noite' }).getAttribute('href')).toBe('/empresas/emp/escalas/turnos/t2');
    fireEvent.click(screen.getByText('08:00–17:00'));
    expect(push).toHaveBeenCalledWith('/empresas/emp/escalas/turnos/t1');
  });
});

describe('Cobertura mínima', () => {
  const dados = [
    { id: 'd1', dia: 'Segunda', faixa: '08:00–12:00', minimo: '2 (ideal 3)', setor: null },
    { id: 'd2', dia: 'Sábado', faixa: '08:00–14:00', minimo: '1', setor: 'Loja' },
  ];
  it('lista dia, faixa, mínimo e setor; gestor abre a faixa', () => {
    render(<TabelaCobertura dados={dados} empresaId="emp" podeGerir />);
    expect(cabecalhos()).toEqual(['Dia', 'Faixa', 'Mínimo', 'Setor']);
    expect(screen.getByText('Empresa toda')).toBeTruthy();
    expect(screen.getByText('Loja')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sábado' }).getAttribute('href')).toBe('/empresas/emp/escalas/cobertura/d2');
  });
  it('quem não gere vê só a lista, sem links nem clique', () => {
    render(<TabelaCobertura dados={dados} empresaId="emp" podeGerir={false} />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByText('Segunda'));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('Férias e afastamentos', () => {
  it('lista pessoa, tipo, período e situação', () => {
    render(<TabelaAusencias empresaId="emp" podeGerir dados={[
      { id: 'a1', pessoa: 'Ana Souza', tipo: 'ferias', periodo: '01/12/2026 a 10/12/2026', situacao: 'agendada' },
      { id: 'a2', pessoa: 'Bruno Lima', tipo: 'afastamento', periodo: '01/10/2026 a 15/10/2026', situacao: 'encerrada' },
    ]} />);
    expect(cabecalhos()).toEqual(['Pessoa', 'Tipo', 'Período', 'Situação']);
    expect(screen.getByText('Férias')).toBeTruthy();
    expect(screen.getByText('Afastamento')).toBeTruthy();
    expect(screen.getByText('Agendada')).toBeTruthy();
    expect(screen.getByText('Encerrada')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ana Souza' }).getAttribute('href')).toBe('/empresas/emp/escalas/ausencias/a1');
  });
});

describe('tela da faixa de cobertura', () => {
  const d = { id: 'd1', setor_id: null, dia_semana: 1, faixa_inicio_min: 480, faixa_fim_min: 720, minimo: 2, ideal: 3 };
  it('cabeçalho e resumo; remover pede confirmação, remove e volta para a lista', async () => {
    render(<TelaFaixa empresaId="emp" demanda={d} setor={null} podeGerir />);
    expect(screen.getByRole('heading', { name: 'Segunda · 08:00–12:00' })).toBeTruthy();
    const resumo = screen.getByLabelText('Resumo da faixa');
    expect(within(resumo).getByText('Segunda')).toBeTruthy();
    expect(within(resumo).getByText('2')).toBeTruthy();
    expect(within(resumo).getByText('3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover faixa' }));
    expect(removerDemanda).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await waitFor(() => expect(removerDemanda).toHaveBeenCalledWith('emp', 'd1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/empresas/emp/escalas/cobertura'));
  });
  it('falha ao remover mostra o erro e não sai da tela; quem não gere não vê a remoção', async () => {
    removerDemanda.mockResolvedValue({ erro: 'Você não tem permissão para remover esta faixa.' });
    const { unmount } = render(<TelaFaixa empresaId="emp" demanda={d} setor="Loja" podeGerir />);
    expect(screen.getByText('Vale só para escalas do setor Loja')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover faixa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    expect(await screen.findByText(/permissão/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    unmount();
    render(<TelaFaixa empresaId="emp" demanda={d} setor={null} podeGerir={false} />);
    expect(screen.queryByRole('button', { name: 'Remover faixa' })).toBeNull();
  });
});

describe('tela da ausência', () => {
  const a = { id: 'a1', pessoa: 'Ana Souza', tipo: 'ferias' as const, inicio: '2026-12-01', fim: '2026-12-10', observacao: 'Férias de fim de ano', situacao: 'agendada' as const };
  it('cabeçalho, resumo com a duração, observação e remoção', async () => {
    render(<TelaAusencia empresaId="emp" ausencia={a} podeGerir />);
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeTruthy();
    expect(screen.getByText('Férias · 01/12/2026 a 10/12/2026')).toBeTruthy();
    expect(screen.getByText('Agendada')).toBeTruthy();
    expect(within(screen.getByLabelText('Resumo da ausência')).getByText('10 dias')).toBeTruthy();
    expect(screen.getByText('Férias de fim de ano')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover lançamento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await waitFor(() => expect(removerAusencia).toHaveBeenCalledWith('emp', 'a1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/empresas/emp/escalas/ausencias'));
  });
  it('um dia só usa o singular; sem observação não mostra o cartão; quem não gere não remove', () => {
    render(<TelaAusencia empresaId="emp" ausencia={{ ...a, fim: '2026-12-01', observacao: null, tipo: 'afastamento', situacao: 'encerrada' }} podeGerir={false} />);
    expect(within(screen.getByLabelText('Resumo da ausência')).getByText('1 dia')).toBeTruthy();
    expect(screen.queryByText('Observação')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover lançamento' })).toBeNull();
  });
});
