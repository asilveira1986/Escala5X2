import { beforeEach, describe, expect, it, vi } from 'vitest';

const EMP = '11111111-1111-4111-8111-111111111111';
const rpc = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock('@/lib/contexto', () => ({ exigirUsuario: async () => ({ supabase: { rpc }, user: { id: 'u' } }) }));
vi.mock('@/lib/supabase/envio-link', () => ({ enviarLinkDeAcesso: vi.fn() }));

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ok = { nome: 'Ana Souza', cpf: '529.982.247-25', admissao: '02/03/2026', salario: '2.500,50', jornada_semanal: '44', tipo_escala: '5x2', setor: 'Padaria', turno: 'Manhã', escolaridade: 'medio', telefone: '(11) 99999-0000', matricula: 'M1', cargo: 'Padeira' };
const rodar = async (o: Record<string, string>) => { const { cadastrarColaborador } = await import('@/app/(app)/empresas/[id]/colaboradores/actions'); try { return await cadastrarColaborador(EMP, {}, form(o)); } catch (e) { return (e as Error).message; } };

beforeEach(() => rpc.mockReset().mockResolvedValue({ data: 'novo-id', error: null }));

describe('cadastrarColaborador (ação)', () => {
  it('valida como a planilha, grava pela função do banco e volta para a lista', async () => {
    expect(await rodar(ok)).toBe(`REDIRECT:/empresas/${EMP}/colaboradores`);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [nome, args] = rpc.mock.calls[0]!;
    expect(nome).toBe('cadastrar_colaborador');
    expect(args).toMatchObject({ p_empresa: EMP, p_nome: 'Ana Souza', p_cpf: '52998224725', p_admissao: '2026-03-02', p_salario: 2500.5, p_jornada_min: 2640, p_divisor: 220, p_tipo_escala: '5x2', p_setor_nome: 'Padaria', p_turno: 'Manhã' });
  });
  it('mostra o erro de cada campo e não chama o banco', async () => {
    const r = await rodar({ ...ok, cpf: '111.111.111-11', salario: '', admissao: '31/02/2026' }) as { erros: Record<string, string>; valores: Record<string, string> };
    expect(Object.keys(r.erros).sort()).toEqual(['admissao', 'cpf', 'salario']);
    expect(r.valores.nome).toBe('Ana Souza'); // mantém o que a pessoa digitou
    expect(rpc).not.toHaveBeenCalled();
  });
  it('grava o CBO escolhido da lista e recusa um código que não existe', async () => {
    expect(await rodar({ ...ok, cbo: '4110-10' })).toMatch(/^REDIRECT/);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_cbo: '411010' });
    rpc.mockClear();
    const r = await rodar({ ...ok, cbo: '999999' }) as { erros: Record<string, string> };
    expect(r.erros.cbo).toMatch(/lista/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('CPF já cadastrado vira erro no campo CPF', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'CPF já cadastrado nesta empresa' } });
    const r = await rodar(ok) as { erros: Record<string, string> };
    expect(r.erros.cpf).toMatch(/Já existe/);
  });
  it('sem permissão: mensagem clara', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'sem permissão' } });
    expect((await rodar(ok) as { erroGeral: string }).erroGeral).toMatch(/permissão/);
  });
});
