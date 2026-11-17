import { describe, expect, it } from 'vitest';
import { caminhoParaEmpresa, empresaDoCaminho, gravarEstadoMenu, lerEstadoMenu, migalhas, montarMenu, posicaoAtual, type ContextoMenu } from './menu';

const E = '11111111-1111-1111-1111-111111111111';
const E2 = '22222222-2222-2222-2222-222222222222';
const ctx = (extra: Partial<ContextoMenu> = {}): ContextoMenu => ({ empresaId: E, ehGestor: true, temMinhaEscala: false, temCarteira: true, ...extra });
const ids = (c: ContextoMenu) => montarMenu(c).flatMap((s) => s.grupos.map((g) => `${s.id}:${g.id}`));

describe('montarMenu', () => {
  it('gestor dentro de uma empresa: Geral, Empresa (com grupos e subitens) e nada de colaborador', () => {
    const m = montarMenu(ctx());
    expect(m.map((s) => s.id)).toEqual(['geral', 'empresa', 'configuracoes']);
    expect(m[0]!.grupos.map((g) => g.id)).toEqual(['carteira']);
    const emp = m[1]!.grupos;
    expect(emp.map((g) => g.id)).toEqual(['visao', 'diagnostico', 'equipe', 'escalas', 'pedidos', 'ponto-folha']);
    expect(emp.find((g) => g.id === 'escalas')!.itens!.map((i) => i.rotulo)).toEqual(['Escalas do mês', 'Turnos', 'Cobertura mínima', 'Férias e afastamentos']);
    expect(emp.find((g) => g.id === 'ponto-folha')!.itens!.map((i) => i.href)).toEqual([`/empresas/${E}/ponto`, `/empresas/${E}/banco-horas`, `/empresas/${E}/folha`]);
    expect(emp.find((g) => g.id === 'equipe')!.itens!.map((i) => i.href)).toEqual([`/empresas/${E}/colaboradores`, `/empresas/${E}/colaboradores/novo`, `/empresas/${E}/importar`]);
  });
  it('Configurações reúne a lista de empresas e o cadastro de nova empresa', () => {
    const cfg = montarMenu(ctx()).find((s) => s.id === 'configuracoes')!;
    expect(cfg.grupos[0]!.itens!.map((i) => [i.rotulo, i.href])).toEqual([['Empresas', '/empresas'], ['Nova empresa', '/empresas/nova']]);
  });
  it('fora de uma empresa não há seção da empresa; sem carteira, o item some', () => {
    expect(ids(ctx({ empresaId: null }))).toEqual(['geral:carteira', 'configuracoes:config']);
    expect(ids(ctx({ empresaId: null, temCarteira: false }))).toEqual(['configuracoes:config']);
  });
  it('colaborador sem papel de gestão: só o menu pessoal', () => {
    const m = montarMenu(ctx({ ehGestor: false, temMinhaEscala: true, temCarteira: false, empresaId: null }));
    expect(m.map((s) => s.id)).toEqual(['colaborador']);
    expect(m[0]!.titulo).toBe('Menu');
    expect(m[0]!.grupos.map((g) => g.href)).toEqual(['/minha-escala', '/minha-escala/pedidos', '/minha-escala/banco-horas']);
  });
  it('gestor que também é colaborador ganha "Minha área" no fim', () => {
    const m = montarMenu(ctx({ temMinhaEscala: true }));
    expect(m.map((s) => s.id)).toEqual(['geral', 'empresa', 'configuracoes', 'colaborador']);
    expect(m.at(-1)!.titulo).toBe('Minha área');
  });
  it('quem não gere nem é colaborador (conta nova) enxerga Empresas para criar a organização', () => {
    expect(ids(ctx({ ehGestor: false, temCarteira: false, empresaId: null }))).toEqual(['configuracoes:config']);
  });
  it('colaborador-só nunca vê a seção da empresa, mesmo com a URL de uma empresa', () => {
    expect(ids(ctx({ ehGestor: false, temMinhaEscala: true, temCarteira: false }))).toEqual(['colaborador:minha-escala', 'colaborador:meus-pedidos', 'colaborador:meu-banco']);
  });
  it('todo destino é único e cada id de grupo/item não se repete', () => {
    const m = montarMenu(ctx({ temMinhaEscala: true }));
    const hrefs = m.flatMap((s) => s.grupos.flatMap((g) => (g.itens ? g.itens.map((i) => i.href) : [g.href!])));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const itens = m.flatMap((s) => s.grupos.flatMap((g) => (g.itens ?? []).map((i) => i.id)));
    expect(new Set(itens).size).toBe(itens.length);
  });
});

describe('posicaoAtual', () => {
  const m = montarMenu(ctx({ temMinhaEscala: true }));
  it('acha o item exato', () => {
    expect(posicaoAtual(m, `/empresas/${E}/escalas/cobertura`)).toMatchObject({ grupoId: 'escalas', itemId: 'cobertura' });
    expect(posicaoAtual(m, `/empresas/${E}/banco-horas`)).toMatchObject({ grupoId: 'ponto-folha', itemId: 'banco-horas' });
    expect(posicaoAtual(m, `/empresas/${E}`)).toMatchObject({ grupoId: 'visao', itemId: null });
    expect(posicaoAtual(m, '/carteira')).toMatchObject({ secaoId: 'geral', grupoId: 'carteira' });
    expect(posicaoAtual(m, '/minha-escala/pedidos')).toMatchObject({ secaoId: 'colaborador', grupoId: 'meus-pedidos' });
  });
  it('páginas de um registro pertencem ao item da lista (editor de escala, extrato de pessoa, diagnóstico)', () => {
    expect(posicaoAtual(m, `/empresas/${E}/escalas/9d3c0a52-0000-0000-0000-000000000001`)).toMatchObject({ grupoId: 'escalas', itemId: 'escalas-lista' });
    expect(posicaoAtual(m, `/empresas/${E}/banco-horas/abc`)).toMatchObject({ itemId: 'banco-horas' });
    expect(posicaoAtual(m, `/empresas/${E}/diagnostico/abc`)).toMatchObject({ grupoId: 'diagnostico' });
    expect(posicaoAtual(m, `/empresas/${E}/importar/xyz`)).toMatchObject({ itemId: 'importar' });
    expect(posicaoAtual(m, `/empresas/${E}/colaboradores/novo`)).toMatchObject({ itemId: 'novo-colaborador' });
    expect(posicaoAtual(m, `/empresas/${E}/colaboradores`)).toMatchObject({ itemId: 'colaboradores' });
  });
  it('o destino mais específico vence (Turnos não acende Escalas do mês)', () => {
    expect(posicaoAtual(m, `/empresas/${E}/escalas/turnos`)).toMatchObject({ itemId: 'turnos' });
    expect(posicaoAtual(m, `/empresas/${E}/escalas`)).toMatchObject({ itemId: 'escalas-lista' });
  });
  it('Visão geral só acende na raiz da empresa; /minha-escala não acende Meus pedidos; barra final e busca são ignoradas', () => {
    expect(posicaoAtual(m, `/empresas/${E}/`)?.grupoId).toBe('visao');
    expect(posicaoAtual(m, `/empresas/${E}/folha?mes=2027-02`)).toMatchObject({ itemId: 'folha' });
    expect(posicaoAtual(m, '/minha-escala')).toMatchObject({ grupoId: 'minha-escala' });
    expect(posicaoAtual(m, '/empresas')).toMatchObject({ grupoId: 'config', itemId: 'config-empresas' });
    expect(posicaoAtual(m, '/empresas/nova')).toMatchObject({ grupoId: 'config', itemId: 'config-nova-empresa' });
  });
  it('caminho desconhecido não marca nada', () => {
    expect(posicaoAtual(m, '/qualquer/coisa')).toBeNull();
    expect(posicaoAtual(m, '/empresasX')).toBeNull();
  });
});

describe('empresa na URL e troca de empresa', () => {
  it('extrai a empresa só de caminhos de empresa', () => {
    expect(empresaDoCaminho(`/empresas/${E}/escalas`)).toBe(E);
    expect(empresaDoCaminho(`/empresas/${E}`)).toBe(E);
    expect(empresaDoCaminho(`/empresas/${E.toUpperCase()}/folha`)).toBe(E);
    expect(empresaDoCaminho('/empresas')).toBeNull();
    expect(empresaDoCaminho('/empresas/nao-e-uuid/escalas')).toBeNull();
    expect(empresaDoCaminho('/carteira')).toBeNull();
  });
  it('trocar de empresa mantém a seção; telas de registro voltam à lista; fora de empresa vai à visão geral', () => {
    expect(caminhoParaEmpresa(`/empresas/${E}/banco-horas`, E2)).toBe(`/empresas/${E2}/banco-horas`);
    expect(caminhoParaEmpresa(`/empresas/${E}/banco-horas/pessoa-1`, E2)).toBe(`/empresas/${E2}/banco-horas`);
    expect(caminhoParaEmpresa(`/empresas/${E}/escalas/cobertura`, E2)).toBe(`/empresas/${E2}/escalas/cobertura`);
    expect(caminhoParaEmpresa(`/empresas/${E}/escalas/uuid-da-escala`, E2)).toBe(`/empresas/${E2}/escalas`);
    expect(caminhoParaEmpresa(`/empresas/${E}/folha?mes=2027-02`, E2)).toBe(`/empresas/${E2}/folha`);
    expect(caminhoParaEmpresa(`/empresas/${E}`, E2)).toBe(`/empresas/${E2}`);
    expect(caminhoParaEmpresa('/empresas', E2)).toBe(`/empresas/${E2}`);
  });
});

describe('migalhas', () => {
  const m = montarMenu(ctx({ temMinhaEscala: true }));
  it('Empresa › Grupo › Página', () => {
    expect(migalhas(m, `/empresas/${E}/escalas/cobertura`, 'Loja Alfa').map((x) => x.rotulo)).toEqual(['Loja Alfa', 'Escalas', 'Cobertura mínima']);
    expect(migalhas(m, `/empresas/${E}/pedidos`.replace('pedidos', 'solicitacoes'), 'Loja Alfa').map((x) => x.rotulo)).toEqual(['Loja Alfa', 'Pedidos']);
    expect(migalhas(m, `/empresas/${E}`, 'Loja Alfa').map((x) => x.rotulo)).toEqual(['Loja Alfa']);
    expect(migalhas(m, '/carteira', null).map((x) => x.rotulo)).toEqual(['Carteira']);
    expect(migalhas(m, '/minha-escala/pedidos', null).map((x) => x.rotulo)).toEqual(['Minha área', 'Meus pedidos']);
    expect(migalhas(m, '/desconhecido', null)).toEqual([]);
  });
});

describe('estado do menu (cookie)', () => {
  it('grava e lê o estado; valor ausente, quebrado ou malicioso vira o padrão', () => {
    expect(lerEstadoMenu(gravarEstadoMenu({ recolhido: true, abertos: ['equipe', 'escalas'] }))).toEqual({ recolhido: true, abertos: ['equipe', 'escalas'] });
    expect(lerEstadoMenu(gravarEstadoMenu({ recolhido: false, abertos: [] }))).toEqual({ recolhido: false, abertos: [] });
    for (const ruim of [undefined, null, '', 'lixo', '%7B', '{"r":"x","a":"y"}']) expect(lerEstadoMenu(ruim as string | undefined), String(ruim)).toEqual({ recolhido: false, abertos: [] });
    expect(lerEstadoMenu(encodeURIComponent('{"r":1,"a":["ok",5,null,"b"]}'))).toEqual({ recolhido: true, abertos: ['ok', 'b'] });
    expect(lerEstadoMenu(encodeURIComponent(JSON.stringify({ r: 0, a: Array.from({ length: 50 }, (_, i) => `g${i}`) }))).abertos).toHaveLength(20);
  });
});
