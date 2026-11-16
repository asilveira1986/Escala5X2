// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const vincularIdentificador = vi.fn(); const desfazerImportacao = vi.fn(); const refresh = vi.fn();
vi.mock('../app/(app)/empresas/[id]/ponto/actions', () => ({ vincularIdentificador, desfazerImportacao }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const { FormImportarAfd } = await import('../app/(app)/empresas/[id]/ponto/FormImportarAfd');
const { Pendentes } = await import('../app/(app)/empresas/[id]/ponto/Pendentes');
const { ListaImportacoes } = await import('../app/(app)/empresas/[id]/ponto/ListaImportacoes');

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const arquivo = () => new File(['conteudo'], 'afd.txt', { type: 'text/plain' });
const escolher = (f: File) => fireEvent.change(screen.getByLabelText(/Arquivo AFD/), { target: { files: [f] } });
const resposta = (status: number, corpo: unknown) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => corpo });

describe('FormImportarAfd', () => {
  it('envia o arquivo, mostra o resultado e atualiza a tela', async () => {
    const f = resposta(200, { ok: true, dialeto: 'portaria_671', marcacoesLidas: 10, inseridas: 8, jaExistiam: 2, periodo: { inicio: '2027-02-01', fim: '2027-02-28' }, naoReconhecidos: 1, errosTotal: 0, avisos: ['O arquivo não tem a linha final (trailer).'] });
    vi.stubGlobal('fetch', f);
    render(<FormImportarAfd empresaId="e1" />);
    const botao = screen.getByRole('button', { name: 'Importar AFD' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    escolher(arquivo());
    fireEvent.click(botao);
    expect(await screen.findByText(/Importado: 8 marcação\(ões\) nova\(s\), 2 já existiam\. Leiaute Portaria 671 \(CPF\)/)).toBeTruthy();
    expect(screen.getByText(/1 identificador\(es\) ainda não reconhecidos/)).toBeTruthy();
    expect(screen.getByText(/não tem a linha final/)).toBeTruthy();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/v1/ponto/importar');
    expect((init.body as FormData).get('empresaId')).toBe('e1');
    expect((init.body as FormData).get('parcial')).toBe('0');
    expect(refresh).toHaveBeenCalled();
  });
  it('arquivo com linhas ruins: mostra os erros por linha e oferece a importação parcial', async () => {
    vi.stubGlobal('fetch', resposta(422, { erro: 'O arquivo tem 2 linha(s) fora do leiaute.', erros: [{ linha: 3, mensagem: 'PIS da marcação inválido.', trecho: '000000002…' }], avisos: [], podeParcial: true }));
    render(<FormImportarAfd empresaId="e1" />);
    escolher(arquivo());
    fireEvent.click(screen.getByRole('button', { name: 'Importar AFD' }));
    expect(await screen.findByText('O arquivo tem 2 linha(s) fora do leiaute.')).toBeTruthy();
    expect(screen.getByText('Linha 3: PIS da marcação inválido.')).toBeTruthy();
    expect(screen.getByText(/marque a opção acima/)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('a opção parcial vai junto no envio', async () => {
    const f = resposta(200, { ok: true, dialeto: 'portaria_1510', marcacoesLidas: 1, inseridas: 1, jaExistiam: 0, periodo: { inicio: null, fim: null }, naoReconhecidos: 0, errosTotal: 3, avisos: [] });
    vi.stubGlobal('fetch', f);
    render(<FormImportarAfd empresaId="e1" />);
    escolher(arquivo());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Importar AFD' }));
    expect(await screen.findByText(/3 linha\(s\) foram ignoradas/)).toBeTruthy();
    expect((f.mock.calls[0]![1].body as FormData).get('parcial')).toBe('1');
  });
  it('sem conexão com o servidor: mensagem clara', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    render(<FormImportarAfd empresaId="e1" />);
    escolher(arquivo());
    fireEvent.click(screen.getByRole('button', { name: 'Importar AFD' }));
    expect(await screen.findByText(/Sem conexão com o servidor/)).toBeTruthy();
  });
});

describe('Pendentes', () => {
  const p = { tipo: 'pis' as const, identificador_hash: 'a'.repeat(64), final4: '8919', marcacoes: '120', primeira: '2027-02-01T11:00:00Z', ultima: '2027-02-28T20:00:00Z' };
  it('vincula o identificador ao colaborador escolhido', async () => {
    vincularIdentificador.mockResolvedValue({ ok: true, mensagem: '120 marcação(ões) vinculada(s).' });
    render(<Pendentes empresaId="e1" pendentes={[p]} colaboradores={[{ id: 'c1', nome: 'Ana' }, { id: 'c2', nome: 'Bia' }]} />);
    expect(screen.getByText(/PIS terminado em 8919/)).toBeTruthy();
    expect(screen.getByText(/120 marcação\(ões\)/)).toBeTruthy();
    const botao = screen.getByRole('button', { name: 'Vincular PIS terminado em 8919' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Colaborador do PIS terminado em 8919'), { target: { value: 'c2' } });
    fireEvent.click(botao);
    await waitFor(() => expect(vincularIdentificador).toHaveBeenCalledWith('e1', 'pis', 'a'.repeat(64), 'c2'));
    expect(await screen.findByText('120 marcação(ões) vinculada(s).')).toBeTruthy();
  });
  it('mostra o erro do servidor', async () => {
    vincularIdentificador.mockResolvedValue({ ok: false, erro: 'O colaborador não pertence a esta empresa.' });
    render(<Pendentes empresaId="e1" pendentes={[p]} colaboradores={[{ id: 'c1', nome: 'Ana' }]} />);
    fireEvent.change(screen.getByLabelText(/Colaborador do PIS/), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: /Vincular/ }));
    expect(await screen.findByText('O colaborador não pertence a esta empresa.')).toBeTruthy();
  });
});

describe('ListaImportacoes', () => {
  const imp = (id: string, status: 'concluida' | 'desfeita' | 'erro') => ({ id, arquivo_nome: `${id}.txt`, status, criado_em: '2027-03-02T12:00:00Z', relatorio: { inseridas: 5, periodo: { inicio: '2027-02-01', fim: '2027-02-28' } } });
  it('desfazer exige motivo e só aparece nas concluídas', async () => {
    desfazerImportacao.mockResolvedValue({ ok: true, mensagem: 'Importação desfeita (5 marcação(ões) removida(s)).' });
    render(<ListaImportacoes empresaId="e1" podeGerir importacoes={[imp('a', 'concluida'), imp('b', 'desfeita'), imp('c', 'erro')]} />);
    expect(screen.getAllByRole('button', { name: /Desfazer a importação/ })).toHaveLength(1);
    expect(screen.getByText('Desfeita')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer a importação de a.txt' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Arquivo de outra empresa' } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(desfazerImportacao).toHaveBeenCalledWith('e1', 'a', 'Arquivo de outra empresa'));
    expect(await screen.findByText(/Importação desfeita/)).toBeTruthy();
  });
  it('quem não gere a empresa não vê o botão', () => {
    render(<ListaImportacoes empresaId="e1" podeGerir={false} importacoes={[imp('a', 'concluida')]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
