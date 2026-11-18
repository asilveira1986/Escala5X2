// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REGRAS_SEED } from '../../../packages/rules-engine/src/fixtures/regras';
import { colab } from '../../../packages/rules-engine/test/util';
import { diagnosticar } from '@jc/rules-engine';
import { resumirProntidao } from '@/lib/prontidao';

const E = '11111111-1111-4111-8111-111111111111';
const equipe = [colab({ colaboradorId: 'a', nome: 'Ana', setor: 'Loja', tipoEscala: '6x1', jornadaSemanalMin: 2640, folgasSemana: 1, salarioBaseCentavos: 300000 }), colab({ colaboradorId: 'b', nome: 'Bia', setor: 'Loja', tipoEscala: '5x2', jornadaSemanalMin: 2400, folgasSemana: 2, salarioBaseCentavos: 300000 })];
const chamarRpc = vi.fn(async (_c: unknown, nome: string, _args?: unknown) => (nome === 'diagnostico_entrada' ? { regras: REGRAS_SEED, colaboradores: equipe, semContrato: 0 } : { novos: 1, atualizados: 0, mantidos: 0 }));
vi.mock('@/lib/contexto', async (orig) => ({ ...(await orig<typeof import('@/lib/contexto')>()), exigirUsuario: async () => ({ supabase: {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@jc/servicos', async (orig) => ({ ...(await orig<typeof import('@jc/servicos')>()), chamar: (c: unknown, n: string, a: unknown) => chamarRpc(c, n, a), lerEntradaDiagnostico: (x: unknown) => x }));
afterEach(cleanup);
beforeEach(() => chamarRpc.mockClear());

describe('emitirComunicados (ação)', () => {
  it('envia à função só quem perde horas, com os valores da fase', async () => {
    const { emitirComunicados } = await import('@/app/(app)/empresas/[id]/prontidao/actions');
    expect(await emitirComunicados(E, 'F1')).toEqual({ ok: true, novos: 1, atualizados: 0, mantidos: 0 });
    const chamada = chamarRpc.mock.calls.find((c) => c[1] === 'emitir_comunicados')!;
    expect(chamada[2]).toEqual({ p_empresa: E, p_fase: 'F1', p_itens: [{ colaboradorId: 'a', inicio: '2026-12-15', jornadaAtualMin: 2640, novaJornadaMin: 2520, diasTrabalho: 5, diasRepouso: 2 }] });
  });
  it('recusa fase inválida e traduz falta de permissão', async () => {
    const { emitirComunicados } = await import('@/app/(app)/empresas/[id]/prontidao/actions');
    expect(await emitirComunicados(E, 'F9')).toEqual({ ok: false, erro: 'Pedido inválido.' });
    const { ErroServico } = await import('@jc/servicos');
    chamarRpc.mockRejectedValueOnce(new ErroServico('permission denied'));
    expect(await emitirComunicados(E, 'F1')).toEqual({ ok: false, erro: 'Você não tem permissão para emitir comunicados desta empresa.' });
  });
});

describe('Prontidão: emissão e ciência', () => {
  const d = diagnosticar(equipe, '2026-11-17', REGRAS_SEED);
  const montar = async (emissao: { fase: 'F1' | 'F2'; ciente: boolean; nome: string }[] | null) => {
    const { Prontidao } = await import('@/app/(app)/empresas/[id]/prontidao/Prontidao');
    return render(<Prontidao empresaId={E} d={d} p={resumirProntidao(d, '2026-11-17')} comunicados={{ F1: 1, F2: 1 }} emissao={emissao} />);
  };
  it('emite pela tela e mostra o resultado', async () => {
    await montar([]);
    fireEvent.click(screen.getByRole('button', { name: 'Emitir fase 1' }));
    expect(await screen.findByText(/1 emitido\(s\), 0 atualizado\(s\)/)).toBeTruthy();
  });
  it('mostra quantos deram ciência e quem falta', async () => {
    await montar([{ fase: 'F1', ciente: true, nome: 'Ana' }, { fase: 'F1', ciente: false, nome: 'Caio' }]);
    expect(screen.getByText(/2 emitido\(s\), 1 com ciência, 1 pendente\(s\)/)).toBeTruthy();
    expect(screen.getByText(/Pendentes: Caio/)).toBeTruthy();
  });
  it('sem a tabela (SQL não aplicado) a emissão não aparece, mas o PDF continua', async () => {
    await montar(null);
    expect(screen.queryByRole('button', { name: 'Emitir fase 1' })).toBeNull();
    expect(screen.getByRole('link', { name: /Fase 1 · 1 comunicado \(PDF\)/ })).toBeTruthy();
  });
});
