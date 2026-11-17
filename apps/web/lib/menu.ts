/**
 * Estrutura do menu lateral. Dados puros (sem React): o que existe, onde fica e como saber onde a pessoa está.
 * Os ícones são nomes; quem desenha (components/Navegacao) os converte em SVG.
 */
export type IconeId =
  | 'inicio' | 'carteira' | 'empresas' | 'diagnostico' | 'equipe' | 'pessoas' | 'importar' | 'escalas' | 'calendario' | 'turnos' | 'cobertura'
  | 'ferias' | 'pedidos' | 'ponto' | 'relogio' | 'banco' | 'folha' | 'minha-escala' | 'config' | 'mais';

export type ItemMenu = { id: string; rotulo: string; href: string; icone: IconeId };
/** Grupo com subitens (accordion) ou, sem `itens`, um link direto. */
export type GrupoMenu = { id: string; rotulo: string; icone: IconeId; href?: string; itens?: ItemMenu[] };
export type SecaoMenu = { id: 'geral' | 'empresa' | 'configuracoes' | 'colaborador'; titulo: string; grupos: GrupoMenu[] };

export type ContextoMenu = {
  /** Empresa aberta no momento (da URL); null fora de uma empresa. */
  empresaId: string | null;
  /** Gere empresas (RH, admin, contador, advogado). */
  ehGestor: boolean;
  /** Tem cadastro de colaborador ligado ao acesso. */
  temMinhaEscala: boolean;
  temCarteira: boolean;
};

export function montarMenu(c: ContextoMenu): SecaoMenu[] {
  const secoes: SecaoMenu[] = [];
  const mostrarGeral = c.ehGestor || !c.temMinhaEscala;
  if (mostrarGeral) {
    if (c.temCarteira) secoes.push({ id: 'geral', titulo: 'Geral', grupos: [{ id: 'carteira', rotulo: 'Carteira', icone: 'carteira', href: '/carteira' }] });
  }
  if (c.empresaId && mostrarGeral) {
    const e = `/empresas/${c.empresaId}`;
    secoes.push({
      id: 'empresa', titulo: 'Empresa',
      grupos: [
        { id: 'visao', rotulo: 'Visão geral', icone: 'inicio', href: e },
        { id: 'diagnostico', rotulo: 'Diagnóstico', icone: 'diagnostico', href: `${e}/diagnostico` },
        { id: 'equipe', rotulo: 'Equipe', icone: 'equipe', itens: [
          { id: 'colaboradores', rotulo: 'Colaboradores', href: `${e}/colaboradores`, icone: 'pessoas' },
          { id: 'importar', rotulo: 'Importar planilha', href: `${e}/importar`, icone: 'importar' },
        ] },
        { id: 'escalas', rotulo: 'Escalas', icone: 'escalas', itens: [
          { id: 'escalas-lista', rotulo: 'Escalas do mês', href: `${e}/escalas`, icone: 'calendario' },
          { id: 'turnos', rotulo: 'Turnos', href: `${e}/escalas/turnos`, icone: 'turnos' },
          { id: 'cobertura', rotulo: 'Cobertura mínima', href: `${e}/escalas/cobertura`, icone: 'cobertura' },
          { id: 'ausencias', rotulo: 'Férias e afastamentos', href: `${e}/escalas/ausencias`, icone: 'ferias' },
        ] },
        { id: 'pedidos', rotulo: 'Pedidos', icone: 'pedidos', href: `${e}/solicitacoes` },
        { id: 'ponto-folha', rotulo: 'Ponto e folha', icone: 'folha', itens: [
          { id: 'ponto', rotulo: 'Ponto (AFD)', href: `${e}/ponto`, icone: 'relogio' },
          { id: 'banco-horas', rotulo: 'Banco de horas', href: `${e}/banco-horas`, icone: 'banco' },
          { id: 'folha', rotulo: 'Fechamento da folha', href: `${e}/folha`, icone: 'folha' },
        ] },
      ],
    });
  }
  if (mostrarGeral) {
    secoes.push({
      id: 'configuracoes', titulo: 'Sistema',
      grupos: [{ id: 'config', rotulo: 'Configurações', icone: 'config', itens: [
        { id: 'config-empresas', rotulo: 'Empresas', href: '/empresas', icone: 'empresas' },
        { id: 'config-nova-empresa', rotulo: 'Nova empresa', href: '/empresas/nova', icone: 'mais' },
      ] }],
    });
  }
  if (c.temMinhaEscala) {
    secoes.push({
      id: 'colaborador', titulo: c.ehGestor ? 'Minha área' : 'Menu',
      grupos: [
        { id: 'minha-escala', rotulo: 'Minha escala', icone: 'minha-escala', href: '/minha-escala' },
        { id: 'meus-pedidos', rotulo: 'Meus pedidos', icone: 'pedidos', href: '/minha-escala/pedidos' },
        { id: 'meu-banco', rotulo: 'Meu banco de horas', icone: 'banco', href: '/minha-escala/banco-horas' },
      ],
    });
  }
  return secoes;
}

export type PosicaoMenu = { secaoId: SecaoMenu['id']; grupoId: string; itemId: string | null; hrefAtivo: string };

/** Todos os destinos do menu, com o grupo a que pertencem. */
function destinos(secoes: SecaoMenu[]) {
  return secoes.flatMap((s) => s.grupos.flatMap((g) => (g.itens
    ? g.itens.map((i) => ({ secaoId: s.id, grupoId: g.id, itemId: i.id as string | null, href: i.href }))
    : g.href ? [{ secaoId: s.id, grupoId: g.id, itemId: null as string | null, href: g.href }] : [])));
}

/** Onde a pessoa está: o destino mais específico cujo endereço é o caminho ou um prefixo dele (ex.: /escalas/<id> → Escalas do mês). */
export function posicaoAtual(secoes: SecaoMenu[], caminho: string): PosicaoMenu | null {
  const limpo = caminho.split('?')[0]!.replace(/\/+$/, '') || '/';
  let melhor: (ReturnType<typeof destinos>[number]) | null = null;
  for (const d of destinos(secoes)) {
    if ((limpo === d.href || limpo.startsWith(`${d.href}/`)) && (!melhor || d.href.length > melhor.href.length)) melhor = d;
  }
  return melhor ? { secaoId: melhor.secaoId, grupoId: melhor.grupoId, itemId: melhor.itemId, hrefAtivo: melhor.href } : null;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Empresa da URL (/empresas/<uuid>/...), ou null. */
export function empresaDoCaminho(caminho: string): string | null {
  const m = new RegExp(`^/empresas/(${UUID})(?:/|$)`, 'i').exec(caminho);
  return m ? m[1]!.toLowerCase() : null;
}

/** Ao trocar de empresa, mantém a seção onde a pessoa estava (ex.: Banco de horas); telas de um registro específico voltam à lista. */
export function caminhoParaEmpresa(caminho: string, novaEmpresaId: string): string {
  const atual = empresaDoCaminho(caminho);
  if (!atual) return `/empresas/${novaEmpresaId}`;
  const resto = caminho.slice(`/empresas/${atual}`.length).split('?')[0]!;
  const base = ['/escalas/cobertura', '/escalas/ausencias', '/escalas/turnos', '/escalas', '/colaboradores', '/importar', '/diagnostico', '/solicitacoes', '/ponto', '/banco-horas', '/folha']
    .find((b) => resto === b || resto.startsWith(`${b}/`));
  return `/empresas/${novaEmpresaId}${base ?? ''}`;
}

export type Migalha = { rotulo: string; href?: string };
/** Caminho de navegação para a barra de cima: Empresa › Grupo › Página. */
export function migalhas(secoes: SecaoMenu[], caminho: string, nomeEmpresa: string | null): Migalha[] {
  const pos = posicaoAtual(secoes, caminho);
  if (!pos) return [];
  const secao = secoes.find((s) => s.id === pos.secaoId)!;
  const grupo = secao.grupos.find((g) => g.id === pos.grupoId)!;
  const item = grupo.itens?.find((i) => i.id === pos.itemId);
  const lista: Migalha[] = [];
  if (secao.id === 'empresa' && nomeEmpresa) lista.push({ rotulo: nomeEmpresa, href: secao.grupos[0]?.href });
  else if (secao.id === 'colaborador') lista.push({ rotulo: 'Minha área' });
  if (item) { lista.push({ rotulo: grupo.rotulo }); lista.push({ rotulo: item.rotulo, href: item.href }); }
  else if (!(secao.id === 'empresa' && grupo.id === 'visao')) lista.push({ rotulo: grupo.rotulo, href: grupo.href });
  return lista;
}

/** Cookie que guarda o estado do menu: recolhido e grupos abertos. */
export const COOKIE_MENU = 'jc-menu';
/** Última empresa aberta: é a "empresa principal" em que o sistema abre. */
export const COOKIE_EMPRESA = 'jc-empresa';
export type EstadoMenu = { recolhido: boolean; abertos: string[] };
export function lerEstadoMenu(valor: string | undefined | null): EstadoMenu {
  try {
    const j = JSON.parse(decodeURIComponent(valor ?? '')) as { r?: unknown; a?: unknown };
    return { recolhido: j.r === 1 || j.r === true, abertos: Array.isArray(j.a) ? j.a.filter((x): x is string => typeof x === 'string').slice(0, 20) : [] };
  } catch { return { recolhido: false, abertos: [] }; }
}
export const gravarEstadoMenu = (e: EstadoMenu): string => encodeURIComponent(JSON.stringify({ r: e.recolhido ? 1 : 0, a: e.abertos }));
