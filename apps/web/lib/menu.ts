/**
 * Estrutura do menu lateral. Dados puros (sem React): o que existe, onde fica e como saber onde a pessoa está.
 * Os ícones são nomes; quem desenha (components/Navegacao) os converte em SVG.
 */
export type IconeId =
  | 'inicio' | 'carteira' | 'empresas' | 'diagnostico' | 'equipe' | 'pessoas' | 'importar' | 'escalas' | 'calendario' | 'turnos' | 'cobertura'
  | 'ferias' | 'pedidos' | 'ponto' | 'relogio' | 'banco' | 'folha' | 'minha-escala' | 'config' | 'mais';

export type ItemMenu = { id: string; rotulo: string; href: string; icone: IconeId; /** Frase curta que aparece no cabeçalho da página e nos cartões da Visão geral. */ descricao?: string; /** A página desenha o próprio título: o Shell não repete o cabeçalho. */ proprioTitulo?: boolean };
/** Grupo com subitens (accordion) ou, sem `itens`, um link direto. */
export type GrupoMenu = { id: string; rotulo: string; icone: IconeId; href?: string; itens?: ItemMenu[]; descricao?: string; proprioTitulo?: boolean };
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
    if (c.temCarteira) secoes.push({ id: 'geral', titulo: 'Geral', grupos: [{ id: 'carteira', rotulo: 'Carteira', icone: 'carteira', href: '/carteira', descricao: 'Suas empresas, das que mais precisam de atenção para as que estão em dia.', proprioTitulo: true }] });
  }
  if (c.empresaId && mostrarGeral) {
    const e = `/empresas/${c.empresaId}`;
    secoes.push({
      id: 'empresa', titulo: 'Empresa',
      grupos: [
        { id: 'visao', rotulo: 'Visão geral', icone: 'inicio', href: e, descricao: 'Resumo da empresa e atalhos para tudo.', proprioTitulo: true },
        { id: 'diagnostico', rotulo: 'Diagnóstico', icone: 'diagnostico', href: `${e}/diagnostico`, descricao: 'Quem precisa se adequar à escala 5x2 e quanto cada caminho custa.' },
        { id: 'equipe', rotulo: 'Equipe', icone: 'equipe', itens: [
          { id: 'colaboradores', rotulo: 'Colaboradores', href: `${e}/colaboradores`, icone: 'pessoas', descricao: 'Equipe, contratos e acesso ao aplicativo.' },
          { id: 'novo-colaborador', rotulo: 'Novo colaborador', href: `${e}/colaboradores/novo`, icone: 'mais', descricao: 'Cadastre uma pessoa e o contrato dela, sem planilha.', proprioTitulo: true },
          { id: 'importar', rotulo: 'Importar planilha', href: `${e}/importar`, icone: 'importar', descricao: 'Traga a equipe inteira de uma planilha CSV ou Excel.' },
        ] },
        { id: 'escalas', rotulo: 'Escalas', icone: 'escalas', itens: [
          { id: 'escalas-lista', rotulo: 'Escalas do mês', href: `${e}/escalas`, icone: 'calendario', descricao: 'Monte, confira com a lei e publique a escala.' },
          { id: 'adequador', rotulo: 'Gerar escala', href: `${e}/escalas/adequador`, icone: 'escalas', descricao: 'Informe turnos, setores e pessoas e o sistema monta a escala do mês, com folgas e férias.' },
          { id: 'turnos', rotulo: 'Turnos', href: `${e}/escalas/turnos`, icone: 'turnos', descricao: 'Modelos de horário para pintar na grade.' },
          { id: 'cobertura', rotulo: 'Cobertura mínima', href: `${e}/escalas/cobertura`, icone: 'cobertura', descricao: 'Quantas pessoas cada setor precisa por turno.' },
          { id: 'ausencias', rotulo: 'Férias e afastamentos', href: `${e}/escalas/ausencias`, icone: 'ferias', descricao: 'Dias em que a pessoa não pode ser escalada.' },
        ] },
        { id: 'pedidos', rotulo: 'Pedidos', icone: 'pedidos', href: `${e}/solicitacoes`, descricao: 'Trocas, folgas e férias esperando a sua decisão.' },
        { id: 'ponto-folha', rotulo: 'Ponto e folha', icone: 'folha', itens: [
          { id: 'ponto', rotulo: 'Ponto (AFD)', href: `${e}/ponto`, icone: 'relogio', descricao: 'Importe as marcações do relógio de ponto e compare com a escala.' },
          { id: 'banco-horas', rotulo: 'Banco de horas', href: `${e}/banco-horas`, icone: 'banco', descricao: 'Saldos, créditos e compensações de cada pessoa.' },
          { id: 'banco-ponto', rotulo: 'Banco pelo ponto', href: `${e}/banco-horas/ponto`, icone: 'banco', descricao: 'Lance no banco as horas a mais e a menos apuradas pelo ponto.' },
          { id: 'folha', rotulo: 'Fechamento da folha', href: `${e}/folha`, icone: 'folha', descricao: 'Feche o mês e exporte as horas para a folha de pagamento.' },
        ] },
      ],
    });
  }
  if (mostrarGeral) {
    secoes.push({
      id: 'configuracoes', titulo: 'Sistema',
      grupos: [{ id: 'config', rotulo: 'Configurações', icone: 'config', itens: [
        { id: 'config-empresas', rotulo: 'Empresas', href: '/empresas', icone: 'empresas', descricao: 'As empresas que você atende.', proprioTitulo: true },
        { id: 'config-nova-empresa', rotulo: 'Nova empresa', href: '/empresas/nova', icone: 'mais', descricao: 'Cadastre uma empresa para começar.', proprioTitulo: true },
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

/** Título, descrição e ícone da página atual quando ela é um destino do menu (item ou grupo sem subitens). */
export function entradaAtual(secoes: SecaoMenu[], pos: PosicaoMenu | null): { rotulo: string; descricao?: string; icone: IconeId; proprioTitulo?: boolean } | null {
  if (!pos) return null;
  const g = secoes.flatMap((s) => s.grupos).find((x) => x.id === pos.grupoId);
  if (!g) return null;
  const i = g.itens?.find((x) => x.id === pos.itemId);
  return i ? { rotulo: i.rotulo, descricao: i.descricao, icone: i.icone, proprioTitulo: i.proprioTitulo } : { rotulo: g.rotulo, descricao: g.descricao, icone: g.icone, proprioTitulo: g.proprioTitulo };
}

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
  const base = ['/escalas/adequador', '/escalas/cobertura', '/escalas/ausencias', '/escalas/turnos', '/escalas', '/colaboradores', '/importar', '/diagnostico', '/solicitacoes', '/ponto', '/banco-horas/ponto', '/banco-horas', '/folha']
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

/** Cor de apoio de cada área do sistema (o ícone herda a cor da sua área). */
export type TomCor = 'marca' | 'azul' | 'violeta' | 'verde' | 'ambar' | 'rosa' | 'neutro';
const TOM_DO_ICONE: Record<IconeId, TomCor> = {
  inicio: 'marca', carteira: 'azul', empresas: 'marca', diagnostico: 'rosa', equipe: 'azul', pessoas: 'azul', importar: 'azul', escalas: 'violeta',
  calendario: 'violeta', turnos: 'violeta', cobertura: 'violeta', ferias: 'violeta', pedidos: 'ambar', ponto: 'verde', relogio: 'verde', banco: 'verde',
  folha: 'verde', 'minha-escala': 'violeta', config: 'neutro', mais: 'verde',
};
export const tomDoIcone = (icone: IconeId): TomCor => TOM_DO_ICONE[icone];
