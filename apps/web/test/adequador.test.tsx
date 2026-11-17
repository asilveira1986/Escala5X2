// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const E = '11111111-1111-4111-8111-111111111111', M1 = '22222222-2222-4222-8222-222222222222', M2 = '55555555-5555-4555-8555-555555555555', ESC = '33333333-3333-4333-8333-333333333333';
const S1 = '44444444-4444-4444-8444-444444444444', S2 = '66666666-6666-4666-8666-666666666666', P1 = '77777777-7777-4777-8777-777777777777';
const gerar = vi.fn();
vi.mock('@/app/(app)/empresas/[id]/escalas/adequador/actions', () => ({ gerarEscalas: (...a: unknown[]) => gerar(...a) }));

const dados = (extra = {}) => ({
  escalaId: ESC, revisao: 2, criada: true,
  resumo: { necessarioTotal: 280, alocadoTotal: 266, faltaTotal: 14, percentualAtendido: 95, diasComFalta: 7, pessoasAlocadas: 3 },
  avisos: ['Faltam 14 posição(ões) de cobertura no mês com a equipe atual (3 pessoa(s)).'], bloqueios: 0, alertas: 1,
  violacoes: [{ codigo: 'COBERTURA_MINIMA', severidade: 'alerta', quantidade: 7, exemplo: 'Cobertura abaixo do mínimo na faixa 08:00–17:00' }],
  faltas: [{ data: '2027-03-03', turnoId: 't1', necessario: 3, alocado: 2, falta: 1 }],
  pessoas: [{ colaboradorId: 'a', nome: 'Ana', turnoId: 't1', diasTrabalhados: 20, horasSemanaMediaMin: 2400, domingosTrabalhados: 0, feriadosTrabalhados: 0 }],
  diasFechados: ['2027-03-07', '2027-03-14'], ausencias: [{ colaboradorId: 'a', nome: 'Ana', inicio: '2027-03-10', fim: '2027-03-16', tipo: 'ferias', dias: 7 }],
  turnos: [{ id: 't1', nome: 'Manhã' }], grade: { dias: ['2027-03-01', '2027-03-02', '2027-03-07'], linhas: [{ colaboradorId: 'a', nome: 'Ana', celulas: ['0', '0', 'F'] }] }, ...extra,
});
beforeEach(() => gerar.mockReset().mockResolvedValue({ ok: true, setores: [{ setorId: S1, setorNome: 'Loja', ok: true, ...dados() }] }));
afterEach(cleanup);

const montar = async (props: Record<string, unknown> = {}) => {
  const { GerarEscala } = await import('@/app/(app)/empresas/[id]/escalas/adequador/Adequador');
  return render(<GerarEscala empresaId={E} mesPadrao="2027-03" semSetor={0} todos={[]} ausencias={[]}
    modelos={[{ id: M1, nome: 'Manhã', inicio: '08:00', fim: '17:00', intervalo: 60 }, { id: M2, nome: 'Tarde', inicio: '14:00', fim: '23:00', intervalo: 60 }]}
    setores={[{ id: S1, nome: 'Loja', pessoas: [{ id: P1, nome: 'Ana' }, { id: 'p2', nome: 'Bia' }, { id: 'p3', nome: 'Caio' }, { id: 'p4', nome: 'Dani' }, { id: 'p5', nome: 'Edu' }, { id: 'p6', nome: 'Fabi' }] }, { id: S2, nome: 'Estoque', pessoas: [{ id: 'q1', nome: 'Gil' }, { id: 'q2', nome: 'Hana' }] }]} {...props} />);
};
const botaoGerar = () => screen.getByRole('button', { name: /^Gerar escala/ });

describe('Gerar escala (tela)', () => {
  it('mostra os setores com a equipe, os turnos com as horas e sugere a cobertura pela equipe de cada setor', async () => {
    await montar();
    expect(screen.getAllByText(/· 40h\/sem/)).toHaveLength(2);
    expect(screen.getByText('6 pessoas')).toBeTruthy();
    expect(screen.getByText('2 pessoas')).toBeTruthy();
    expect(screen.getByLabelText('Loja, Manhã: pessoas na Seg')).toHaveProperty('value', '2');      // 6 ÷ 2 turnos × 5 ÷ 7
    expect(screen.getByLabelText('Estoque, Manhã: pessoas na Seg')).toHaveProperty('value', '1');
    expect(screen.getByLabelText('Loja, Manhã: pessoas na Dom')).toHaveProperty('value', '0');       // domingo fechado por padrão
  });

  it('dias de funcionamento: fechar um dia desabilita a cobertura dele; abrir devolve a sugestão', async () => {
    await montar();
    expect((screen.getByLabelText('Loja, Manhã: pessoas na Dom') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Funciona na Sáb'));
    expect((screen.getByLabelText('Loja, Manhã: pessoas na Sáb') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Funciona na Dom'));
    expect((screen.getByLabelText('Loja, Manhã: pessoas na Dom') as HTMLInputElement).disabled).toBe(false);
  });

  it('o pedido leva funcionamento, feriados, turnos, cobertura por setor e folgas fixas; horário editado desliga o turno do cadastro', async () => {
    await montar();
    fireEvent.change(screen.getByLabelText('Saída do turno Manhã'), { target: { value: '16:00' } });
    fireEvent.change(screen.getByLabelText('Loja, Manhã: pessoas na Ter'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText('Não funciona nos feriados (ninguém é escalado)'));
    fireEvent.click(screen.getByLabelText('Ana: folga fixa na Sáb'));
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2027-04' } });
    fireEvent.change(screen.getByLabelText('Dias de trabalho por semana'), { target: { value: '6' } });
    fireEvent.click(botaoGerar());
    await waitFor(() => expect(gerar).toHaveBeenCalled());
    const p = gerar.mock.calls[0]![0];
    expect(p).toMatchObject({ empresaId: E, mes: '2027-04', diasPorSemana: 6, funcionamento: [false, true, true, true, true, true, true], fecharNosFeriados: true, folgasFixas: { [P1]: [6] } });
    expect(p.turnos[0]).toMatchObject({ nome: 'Manhã', fim: '16:00', modeloId: null });
    expect(p.turnos[1].modeloId).toBe(M2);
    expect(p.setores.map((s: { setorId: string }) => s.setorId)).toEqual([S1, S2]);
    expect(p.setores[0].minimos[p.turnos[0].chave][2]).toBe(4);                                       // terça no setor Loja
    expect(p.setores[1].minimos[p.turnos[0].chave][2]).not.toBe(4);                                    // o outro setor não muda
  });

  it('desmarcar um setor o tira da geração (e das folgas fixas)', async () => {
    await montar();
    fireEvent.click(screen.getByLabelText('Gerar a escala do setor Estoque'));
    fireEvent.click(botaoGerar());
    await waitFor(() => expect(gerar).toHaveBeenCalled());
    expect(gerar.mock.calls[0]![0].setores.map((s: { setorId: string }) => s.setorId)).toEqual([S1]);
  });

  it('mostra as férias do mês ao lado de cada pessoa', async () => {
    await montar({ ausencias: [{ colaboradorId: P1, inicio: '2027-03-10', fim: '2027-03-16', tipo: 'ferias' }, { colaboradorId: 'p2', inicio: '2027-05-01', fim: '2027-05-10', tipo: 'ferias' }] });
    expect(screen.getByText('Férias 10/03–16/03')).toBeTruthy();
    expect(screen.queryByText(/01\/05–10\/05/)).toBeNull();                      // fora do mês escolhido
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2027-05' } });
    expect(screen.getByText('Férias 01/05–10/05')).toBeTruthy();
  });

  it('resultado por setor: cobertura, falta de gente, dias fechados, férias e atalho para o editor; setor com erro não esconde os outros', async () => {
    gerar.mockResolvedValue({ ok: true, setores: [{ setorId: S1, setorNome: 'Loja', ok: true, ...dados() }, { setorId: S2, setorNome: 'Estoque', ok: false, erro: 'Não há colaboradores com contrato vigente neste período.' }] });
    await montar();
    fireEvent.click(botaoGerar());
    expect(await screen.findByText('95%')).toBeTruthy();
    expect(screen.getByText(/14 posição\(ões\) ficam descobertas/)).toBeTruthy();
    expect(screen.getByText('2/3')).toBeTruthy();
    expect(screen.getByText(/2 dia\(s\) fechado\(s\)/)).toBeTruthy();
    expect(screen.getByText(/férias de 10\/03\/2027 a 16\/03\/2027 \(7 dias\)/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir no editor de escalas' }).getAttribute('href')).toBe(`/empresas/${E}/escalas/${ESC}`);
    expect(screen.getByText(/Não há colaboradores com contrato vigente/)).toBeTruthy();
  });

  it('erro geral aparece; sem pessoas/sem dia aberto/sem cobertura não deixa gerar', async () => {
    gerar.mockResolvedValue({ ok: false, erro: 'Informe pelo menos um turno.' });
    await montar();
    fireEvent.click(botaoGerar());
    expect(await screen.findByText('Informe pelo menos um turno.')).toBeTruthy();
    cleanup();
    await montar({ setores: [{ id: S1, nome: 'Loja', pessoas: [] }] });
    expect((botaoGerar() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Escolha ao menos um setor com pessoas.').length).toBeGreaterThan(0);
  });

  it('empresa sem setores cadastrados: gera para a empresa toda', async () => {
    await montar({ setores: [], todos: [{ id: P1, nome: 'Ana' }, { id: 'p2', nome: 'Bia' }] });
    fireEvent.click(botaoGerar());
    await waitFor(() => expect(gerar).toHaveBeenCalled());
    expect(gerar.mock.calls[0]![0].setores).toEqual([expect.objectContaining({ setorId: null, nome: 'Empresa toda' })]);
  });

  it('avisa quem está sem setor', async () => {
    await montar({ semSetor: 3 });
    expect(screen.getByText(/3 pessoa\(s\) sem setor ficam de fora/)).toBeTruthy();
  });

  it('jornada: informar as horas ajusta a saída dos turnos que seguem a jornada e o pedido leva os horários ajustados e os dias', async () => {
    await montar();
    fireEvent.change(screen.getByLabelText('Jornada semanal (horas)'), { target: { value: '36' } });
    fireEvent.change(screen.getByLabelText('Dias de trabalho por semana'), { target: { value: '5' } });
    expect(screen.getByText(/5 dias de 7h10/)).toBeTruthy();                               // 36h ÷ 5 = 7h12 → 7h10
    expect(screen.getByLabelText('Saída do turno Manhã, ajustada pela jornada').textContent).toContain('16:10');
    expect(screen.getByLabelText('Saída do turno Tarde, ajustada pela jornada').textContent).toContain('22:10');     // 14:00 + 7h10 + 1h
    fireEvent.click(botaoGerar());
    await waitFor(() => expect(gerar).toHaveBeenCalled());
    const p = gerar.mock.calls[0]![0];
    expect(p.diasPorSemana).toBe(5);
    expect(p.turnos.map((t: { fim: string; modeloId: string | null }) => [t.fim, t.modeloId])).toEqual([['16:10', null], ['22:10', null]]);   // horário mudou: deixa de ser o do cadastro
    expect(await screen.findByText(/Gerada com jornada de 36h por semana em 5 dias \(7h10 líquidas por dia\)/)).toBeTruthy();
  });

  it('jornada: turno que não segue a jornada mantém o horário digitado; sem jornada nada muda', async () => {
    await montar();
    fireEvent.change(screen.getByLabelText('Jornada semanal (horas)'), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText('Tarde segue a jornada'));
    expect((screen.getByLabelText('Saída do turno Tarde') as HTMLInputElement).value).toBe('23:00');
    fireEvent.click(botaoGerar());
    await waitFor(() => expect(gerar).toHaveBeenCalled());
    const p = gerar.mock.calls[0]![0];
    expect(p.turnos[0]).toMatchObject({ fim: '15:00' });                                   // 30h ÷ 5 = 6h + 1h de intervalo
    expect(p.turnos[1]).toMatchObject({ fim: '23:00', modeloId: M2 });                      // não seguiu a jornada: continua o turno do cadastro
    cleanup();
    gerar.mockClear();
    await montar();
    fireEvent.click(botaoGerar());
    await waitFor(() => expect(gerar).toHaveBeenCalled());
    expect(gerar.mock.calls[0]![0].turnos.map((t: { fim: string }) => t.fim)).toEqual(['17:00', '23:00']);
    expect(gerar.mock.calls[0]![0].diasPorSemana).toBeNull();
  });

  it('impacto da jornada: a tabela mostra pessoas necessárias × equipe e "Usar" aplica a jornada e os dias', async () => {
    await montar();
    const tabela = screen.getByRole('table', { name: 'Impacto da jornada' });
    const linha = (rotulo: RegExp) => Array.from(tabela.querySelectorAll('tbody tr')).find((r) => rotulo.test(r.textContent ?? ''))!;
    // Loja: 2 turnos × 2 pessoas × 6 dias abertos = 24 posições; Estoque: 2 × 1 × 6 = 12 (cobertura sugerida). Equipe: 6 + 2 = 8.
    const r44 = linha(/^44h\/semana6/);
    expect(r44.textContent).toContain('sobram 2');                                          // 44h em 6 dias: ⌈24/6⌉ + ⌈12/6⌉ = 6 pessoas
    const r40 = linha(/^40h\/semana5/);
    expect(r40.textContent).toContain('na medida');                                         // 40h em 5 dias: ⌈24/5⌉ + ⌈12/5⌉ = 8 pessoas
    expect(linha(/^36h\/semana5/).textContent).toContain('na medida');
    expect(linha(/^30h\/semana5/).textContent).toContain('na medida');
    fireEvent.click(screen.getByRole('button', { name: 'Usar 40h por semana em 5 dias' }));
    expect(screen.getByLabelText('Jornada semanal (horas)')).toHaveProperty('value', '40');
    expect(screen.getByLabelText('Dias de trabalho por semana')).toHaveProperty('value', '5');
    expect(screen.getByText('em uso')).toBeTruthy();
    expect(screen.queryAllByText(/Turnos como estão/).length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar aos turnos como estão' }));
    expect(screen.getByLabelText('Jornada semanal (horas)')).toHaveProperty('value', '');
  });

  it('jornada fora do que a tela aceita (muito baixa) é ignorada', async () => {
    await montar();
    fireEvent.change(screen.getByLabelText('Jornada semanal (horas)'), { target: { value: '3' } });
    expect(screen.getByText(/Sem jornada informada/)).toBeTruthy();
    expect(screen.queryByLabelText('Saída do turno Manhã, ajustada pela jornada')).toBeNull();
  });

  it('jornada acima do máximo legal (44h) bloqueia a geração com o motivo', async () => {
    await montar();
    fireEvent.change(screen.getByLabelText('Jornada semanal (horas)'), { target: { value: '48' } });
    expect(screen.getByText('A jornada máxima legal é de 44 horas por semana.')).toBeTruthy();
    expect((botaoGerar() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Gerar escala: fim da 6x1', () => {
  const fases = [
    { codigo: 'LEGADO_44H', nome: 'Hoje: 6x1', inicio: null, fim: '2026-12-15', horas: 44, dias: 6, folgas: 1, maxDiariaMin: 480 },
    { codigo: 'EC141_F1', nome: 'Fase 1: 5x2 com 42h', inicio: '2026-12-15', fim: '2027-12-15', horas: 42, dias: 5, folgas: 2, maxDiariaMin: 480 },
    { codigo: 'EC141_F2', nome: 'Fase 2: 5x2 com 40h', inicio: '2027-12-15', fim: null, horas: 40, dias: 5, folgas: 2, maxDiariaMin: 480 },
  ];
  it('mostra as fases, quantos estão em 6x1 e preenche jornada e dias ao adequar', async () => {
    await montar({ fases, em6x1: 5, totalEquipe: 8, hoje: '2026-11-17', mesPadrao: '2027-01' });
    expect(screen.getByText(/5 de 8/)).toBeTruthy();
    expect(screen.getByText('vigente hoje')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adequar à Fase 2: 5x2 com 40h' }));
    expect(screen.getByLabelText('Jornada semanal (horas)')).toHaveProperty('value', '40');
    expect(screen.getByLabelText('Dias de trabalho por semana')).toHaveProperty('value', '5');
  });
  it('avisa se a jornada passa do teto da fase do mês e oferece 40h na fase 1 (acima de 8h por dia)', async () => {
    await montar({ fases, em6x1: 0, totalEquipe: 8, hoje: '2026-11-17', mesPadrao: '2027-01' });
    expect(screen.getByText(/acordo coletivo de jornada diária estendida/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Jornada semanal (horas)'), { target: { value: '44' } });
    expect(screen.getByRole('alert').textContent).toMatch(/teto de 42h/);
    fireEvent.click(screen.getByRole('button', { name: 'Adequar a 40 horas em 5 dias' }));
    expect(screen.getByLabelText('Jornada semanal (horas)')).toHaveProperty('value', '40');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('sem fases cadastradas, o painel não aparece', async () => {
    await montar();
    expect(screen.queryByLabelText('Fim da escala 6x1')).toBeNull();
  });
});
