// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resultadoImportacao } from '../lib/importacao-ui';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('../app/(app)/cobranca/actions', () => ({ assinar: vi.fn(), trocarPlano: vi.fn(), cancelarAssinatura: vi.fn() }));
const { TabelaImportacoes } = await import('../app/(app)/empresas/[id]/importar/TabelaImportacoes');
const { TelaImportacao } = await import('../app/(app)/empresas/[id]/importar/TelaImportacao');
const { TelaCobranca } = await import('../app/(app)/cobranca/TelaCobranca');
const { TabelaFaturas } = await import('../app/(app)/cobranca/TabelaFaturas');

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const cabecalhos = () => screen.getAllByRole('columnheader').map((h) => h.textContent).filter(Boolean);

describe('resultado da importação em uma linha', () => {
  it('concluída traz criados, atualizados e erros; falha traz a mensagem; o resto, travessão', () => {
    expect(resultadoImportacao('concluida', { criados: 12, atualizados: 3, errosTotal: 2 })).toBe('12 criados · 3 atualizados · 2 com erro');
    expect(resultadoImportacao('concluida', { criados: 1, atualizados: 1 })).toBe('1 criado · 1 atualizado');
    expect(resultadoImportacao('erro', { mensagem: 'Arquivo ilegível' })).toBe('Arquivo ilegível');
    expect(resultadoImportacao('erro', null)).toBe('Nenhum dado foi gravado');
    expect(resultadoImportacao('processando', null)).toBe('—');
    expect(resultadoImportacao('aguardando_mapeamento', null)).toBe('—');
  });
});

describe('lista de importações', () => {
  const dados = [
    { id: 'i1', data: '19/11/2026', resultado: '12 criados · 3 atualizados', status: 'concluida' as const },
    { id: 'i2', data: '10/11/2026', resultado: 'Arquivo ilegível', status: 'erro' as const },
  ];
  it('mostra data, resultado e situação; o link e a linha levam à tela da importação', () => {
    render(<TabelaImportacoes dados={dados} empresaId="emp" />);
    expect(cabecalhos()).toEqual(['Enviada em', 'Resultado', 'Situação']);
    expect(screen.getByText('Concluída')).toBeTruthy();
    expect(screen.getByText('Com falha')).toBeTruthy();
    expect(screen.getByRole('link', { name: '19/11/2026' }).getAttribute('href')).toBe('/empresas/emp/importar/i1');
    fireEvent.click(screen.getByText('Arquivo ilegível'));
    expect(push).toHaveBeenCalledWith('/empresas/emp/importar/i2');
  });
  it('sem importações orienta o primeiro envio', () => {
    render(<TabelaImportacoes dados={[]} empresaId="emp" />);
    expect(screen.getByText(/Envie a primeira planilha/)).toBeTruthy();
  });
});

describe('tela da importação', () => {
  const rel = { totalLinhas: 20, criados: 12, atualizados: 3, semAlteracao: 3, ignoradas: 0, setoresCriados: 2, errosTotal: 2, erros: [{ linha: 5, campo: 'CPF', valor: '123', mensagem: 'CPF inválido' }, { linha: 9, campo: 'Salário', valor: 'x', mensagem: 'Salário inválido' }] };
  const imp = (status: 'concluida' | 'erro' | 'processando' | 'aguardando_mapeamento', relatorio: unknown = rel) => ({ id: 'i1', status, criado_em: '2026-11-19T10:00:00Z', relatorio: relatorio as never });

  it('concluída: cabeçalho, resumo, erros por linha, download e próximos passos', () => {
    render(<TelaImportacao empresaId="emp" importacao={imp('concluida')} />);
    expect(screen.getByRole('heading', { name: 'Importação de 19/11/2026' })).toBeTruthy();
    expect(screen.getByText('20 linhas na planilha · 2 setores criados')).toBeTruthy();
    expect(screen.getByText('Concluída')).toBeTruthy();
    const resumo = screen.getByLabelText('Resultado da importação');
    expect(within(resumo).getByText('12')).toBeTruthy();
    expect(within(resumo).getAllByText('3')).toHaveLength(2);
    expect(within(resumo).getByText('2')).toBeTruthy();
    expect(screen.getByText('CPF inválido')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Baixar erros em CSV' }).getAttribute('href')).toBe('/api/v1/importacoes/i1/erros.csv');
    expect(screen.getByRole('link', { name: 'Ver colaboradores' }).getAttribute('href')).toBe('/empresas/emp/colaboradores');
    expect(screen.getByRole('link', { name: 'Rodar diagnóstico' }).getAttribute('href')).toBe('/empresas/emp/diagnostico');
  });
  it('concluída sem erros não mostra o cartão de erros', () => {
    render(<TelaImportacao empresaId="emp" importacao={imp('concluida', { ...rel, errosTotal: 0, erros: [] })} />);
    expect(screen.queryByText('Linhas com erro')).toBeNull();
    expect(screen.getByText('Ver colaboradores')).toBeTruthy();
  });
  it('processando atualiza sozinha; aguardando volta ao assistente; falha explica que nada foi gravado', () => {
    const refresh = () => document.querySelector('meta[http-equiv="refresh"]');   // o React move o <meta> para o <head>
    const { unmount } = render(<TelaImportacao empresaId="emp" importacao={imp('processando', null)} />);
    expect(refresh()).toBeTruthy();
    expect(screen.getByText(/Processando a planilha/)).toBeTruthy();
    unmount();
    const b = render(<TelaImportacao empresaId="emp" importacao={imp('aguardando_mapeamento', null)} />);
    expect(screen.getByRole('link', { name: 'Voltar ao assistente' }).getAttribute('href')).toBe('/empresas/emp/importar');
    expect(refresh()).toBeNull();
    b.unmount();
    render(<TelaImportacao empresaId="emp" importacao={imp('erro', { mensagem: 'Arquivo ilegível' })} />);
    expect(screen.getByText(/Arquivo ilegível\. Nenhum dado foi gravado/)).toBeTruthy();
  });
});

describe('plano e cobrança', () => {
  const planos = [
    { id: 'p1', codigo: 'inicial', nome: 'Inicial', descricao: null, preco_centavos: 14900, limite_colaboradores: 30 },
    { id: 'p2', codigo: 'pro', nome: 'Profissional', descricao: 'Até 200 pessoas', preco_centavos: 39900, limite_colaboradores: 200 },
  ];
  const assinatura = { id: 'a1', status: 'ativa' as const, plano_id: 'p1', teste_ate: null, forma: 'pix' as const, proximo_vencimento: '2026-12-10' };
  const faturas = [
    { id: 'f1', vencimento: '10/12/2026', valor: 'R$ 149,00', forma: 'PIX', status: 'pendente' as const, pagoEm: null, url: 'https://pagar.exemplo/f1' },
    { id: 'f2', vencimento: '10/11/2026', valor: 'R$ 149,00', forma: 'PIX', status: 'paga' as const, pagoEm: '09/11/2026', url: 'https://pagar.exemplo/f2' },
  ];
  const montar = (extra: Partial<Parameters<typeof TelaCobranca>[0]> = {}) => render(
    <TelaCobranca orgId="org" orgNome="Contabilidade Silva" assinatura={assinatura} planos={planos} faturas={faturas} ativos={24} excedeLimite={false} aviso={null} configurado aba="plano" {...extra} />);

  it('cabeçalho com a situação e resumo da assinatura sempre à vista', () => {
    montar();
    expect(screen.getByRole('heading', { name: 'Plano e cobrança' })).toBeTruthy();
    expect(screen.getByText('Assinatura de Contabilidade Silva')).toBeTruthy();
    expect(screen.getByText('Ativa')).toBeTruthy();
    const resumo = screen.getByLabelText('Resumo da assinatura');
    expect(resumo.textContent).toContain('Inicial');
    expect(resumo.textContent).toContain('10/12/2026');
    expect(resumo.textContent).toContain('PIX');
    expect(within(resumo).getByText('24 de 30')).toBeTruthy();
  });
  it('em teste mostra "Teste até"; sem assinatura não há resumo, mas os planos aparecem', () => {
    montar({ assinatura: { ...assinatura, status: 'teste', teste_ate: '2026-12-01', proximo_vencimento: null } });
    expect(within(screen.getByLabelText('Resumo da assinatura')).getByText('Teste até')).toBeTruthy();
    expect(within(screen.getByLabelText('Resumo da assinatura')).getByText('01/12/2026')).toBeTruthy();
    cleanup();
    montar({ assinatura: null });
    expect(screen.queryByLabelText('Resumo da assinatura')).toBeNull();
    expect(screen.getByText('Profissional')).toBeTruthy();
  });
  it('abas por endereço, com a contagem de faturas em aberto', () => {
    montar();
    const links = within(screen.getByRole('navigation', { name: 'Seções do plano e da cobrança' })).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Planos', 'Faturas1']);
    expect(links[1]!.getAttribute('href')).toBe('/cobranca?aba=faturas');
  });
  it('aba Planos: cartões dos planos e o encerramento só com assinatura em andamento', () => {
    montar();
    expect(screen.getByText('Seu plano atual')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trocar para Profissional' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy();
    expect(screen.queryByText('Planos 1')).toBeNull();
    cleanup();
    montar({ assinatura: { ...assinatura, status: 'cancelada' } });
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
  });
  it('avisos: provedor sem configuração e aviso da conta; excedeu o limite destaca os colaboradores', () => {
    montar({ configurado: false, aviso: { tom: 'risco', texto: 'Há uma fatura vencida.' }, excedeLimite: true, ativos: 31 });
    expect(screen.getByText(/ainda não está configurada/)).toBeTruthy();
    expect(screen.getByText('Há uma fatura vencida.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Trocar|^Assinar/ })).toBeNull();     // sem provedor, os planos são só para consulta
    expect(within(screen.getByLabelText('Resumo da assinatura')).getByText('31 de 30').className).toContain('text-atencao-fg');
  });
  it('aba Faturas: tabela com situação, "Pagar" nas abertas e "Ver" nas pagas', () => {
    montar({ aba: 'faturas' });
    expect(screen.getByRole('heading', { name: '2 faturas' })).toBeTruthy();
    expect(cabecalhos()).toEqual(['Vencimento', 'Valor', 'Forma', 'Situação']);
    expect(screen.getByRole('link', { name: 'Pagar a fatura de 10/12/2026' }).getAttribute('href')).toBe('https://pagar.exemplo/f1');
    expect(screen.getByRole('link', { name: 'Ver a fatura de 10/11/2026' }).getAttribute('href')).toBe('https://pagar.exemplo/f2');
    expect(screen.getByText('em 09/11/2026')).toBeTruthy();
    expect(screen.queryByText('Seu plano atual')).toBeNull();
  });
  it('sem faturas orienta a primeira assinatura', () => {
    render(<TabelaFaturas dados={[]} />);
    expect(screen.getByText(/Depois de assinar, a primeira aparece aqui/)).toBeTruthy();
  });
});
