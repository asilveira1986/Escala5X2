'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { entradaAtual, caminhoParaEmpresa, COOKIE_EMPRESA, COOKIE_MENU, empresaDoCaminho, gravarEstadoMenu, migalhas, montarMenu, posicaoAtual, type EstadoMenu, type GrupoMenu, type ItemMenu, type PosicaoMenu, type SecaoMenu } from '@/lib/menu';
import { BotaoSair } from './BotaoSair';
import { CabecalhoPagina } from './ui';
import { Sino } from './Sino';
import { IconeChevron, IconeEmpresa, IconeExpandir, IconeFechar, IconeMenu, IconeRecolher, MarcaLogo } from './icones';
import { ICONES_MENU } from './menu-icones';

export type EmpresaDoMenu = { id: string; nome: string };
export type AvisoCobranca = { tom: 'info' | 'atencao' | 'risco'; texto: string };
export type EstadoCobranca = { aviso: AvisoCobranca | null; bloqueado: boolean };
type Props = {
  cobranca?: EstadoCobranca; naoLidas?: number; email: string; empresas: EmpresaDoMenu[]; ehGestor: boolean; temMinhaEscala: boolean; temCarteira: boolean; estadoInicial: EstadoMenu;
  aviso?: ReactNode; children: ReactNode;
};

/** Ícones do menu herdam a cor do texto (a cor da identidade é estado, não decoração). */
const corIcone = (_icone: unknown, _ativo: boolean) => '';
const classeItem = (ativo: boolean) =>
  `relative flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${ativo ? 'bg-marca-suave font-semibold text-marca' : 'text-tinta hover:bg-fundo'}`;

function gravar(e: EstadoMenu) {
  try { document.cookie = `${COOKIE_MENU}=${gravarEstadoMenu(e)}; path=/; max-age=31536000; samesite=lax`; } catch { /* sem cookie: o menu só não lembra */ }
}

/** Menu lateral recolhível, com grupos e subitens, que vira gaveta no celular. */
export function Shell({ cobranca, naoLidas = 0, email, empresas, ehGestor, temMinhaEscala, temCarteira, estadoInicial, aviso, children }: Props) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [recolhido, setRecolhido] = useState(estadoInicial.recolhido);
  // submenu dinâmico: abre sozinho o grupo da página atual e só um fica aberto; clicar em outro troca, clicar no aberto fecha
  const [escolha, setEscolha] = useState<string | null | undefined>(undefined);
  const [gaveta, setGaveta] = useState(false);

  const empresaId = empresaDoCaminho(pathname);
  const empresa = empresas.find((e) => e.id === empresaId) ?? null;
  const secoes = useMemo(() => montarMenu({ empresaId, ehGestor, temMinhaEscala, temCarteira }), [empresaId, ehGestor, temMinhaEscala, temCarteira]);
  const pos = posicaoAtual(secoes, pathname);
  const entrada = entradaAtual(secoes, pos);
  const limpo = pathname.split('?')[0]!.replace(/\/+$/, '') || '/';
  // só nas páginas que são destino do menu (e têm descrição): as demais já trazem o próprio título
  const cabecalho = entrada?.descricao && !entrada.proprioTitulo && pos?.hrefAtivo === limpo ? entrada : null;
  const grupoAberto = escolha !== undefined ? escolha : (pos?.grupoId ?? null);
  // o título da página já aparece no cabeçalho dela: a barra de cima mostra só o caminho até aqui (sem repetir a página)
  const todasMigalhas = migalhas(secoes, pathname, empresa?.nome ?? (empresaId ? 'Empresa' : null));
  const crumbs = pos?.hrefAtivo === limpo ? todasMigalhas.slice(0, -1) : todasMigalhas;

  const alternarRecolhido = useCallback(() => setRecolhido((r) => { const n = !r; gravar({ recolhido: n, abertos: [] }); return n; }), []);
  const alternarGrupo = useCallback((id: string) => setEscolha(grupoAberto === id ? null : id), [grupoAberto]);
  useEffect(() => { setEscolha(undefined); }, [pathname]);

  // lembra a última empresa aberta: é nela que o sistema abre da próxima vez
  useEffect(() => {
    if (empresaId) { try { document.cookie = `${COOKIE_EMPRESA}=${empresaId}; path=/; max-age=31536000; samesite=lax`; } catch { /* sem cookie: abre na primeira da lista */ } }
  }, [empresaId]);

  // a gaveta fecha ao navegar, com Esc, e trava a rolagem da página
  useEffect(() => { setGaveta(false); }, [pathname]);
  useEffect(() => {
    if (!gaveta) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setGaveta(false); };
    document.addEventListener('keydown', esc);
    const antes = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = antes; };
  }, [gaveta]);

  const trocarEmpresa = (id: string) => { if (id) router.push(caminhoParaEmpresa(pathname, id)); };
  const painel = (modo: 'completo' | 'rail', naGaveta = false) => (
    <PainelMenu modo={modo} naGaveta={naGaveta} secoes={secoes} pos={pos} grupoAberto={grupoAberto} empresas={empresas} empresaId={empresaId} empresaNome={empresa?.nome ?? null}
      email={email} ehGestor={ehGestor} onGrupo={alternarGrupo} onRecolher={alternarRecolhido} onFechar={() => setGaveta(false)} onTrocarEmpresa={trocarEmpresa} />
  );

  const soColaborador = !ehGestor && temMinhaEscala;
  // conta bloqueada por falta de pagamento: só a tela de Plano e cobrança continua acessível
  const bloqueioAtivo = !!cobranca?.bloqueado && !pathname.startsWith('/cobranca');
  return (
    <>
      {aviso}
      <div className="min-h-dvh lg:flex">
        <aside aria-label="Menu lateral" className={`sticky top-0 hidden h-dvh shrink-0 tema-menu border-r border-linha bg-cartao transition-[width] duration-200 lg:block ${recolhido ? 'w-16' : 'w-60'}`}>
          {painel(recolhido ? 'rail' : 'completo')}
        </aside>

        {gaveta ? (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button type="button" aria-label="Fechar o menu" className="absolute inset-0 bg-tinta/40" onClick={() => setGaveta(false)} />
            <aside className="absolute inset-y-0 left-0 tema-menu w-[min(17rem,88vw)] border-r border-linha bg-cartao shadow-2xl">{painel('completo', true)}</aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col bg-[linear-gradient(180deg,color-mix(in_srgb,var(--c-marca)_5%,transparent),transparent_240px)]">
          <header className="sticky top-0 z-30 flex min-h-12 items-center gap-2 border-b border-linha bg-cartao/90 px-3 backdrop-blur sm:px-5">
            <button type="button" onClick={() => setGaveta(true)} aria-label="Abrir o menu" aria-expanded={gaveta} className="grid size-11 place-items-center rounded-xl text-tinta hover:bg-fundo lg:hidden"><IconeMenu /></button>
            <Link href={soColaborador ? '/minha-escala' : '/empresas'} aria-label="JornadaCerta, início" className="flex items-center gap-2 rounded-lg lg:hidden"><MarcaLogo tamanho={24} /></Link>
            <nav aria-label="Você está em" className="min-w-0 flex-1">
              <ol className="flex items-center gap-1.5 truncate text-sm">
                {crumbs.map((c, i) => (
                  <li key={`${c.rotulo}-${i}`} className={`min-w-0 items-center gap-1.5 ${i === 0 && empresa ? 'flex lg:hidden' : 'flex'}`}>
                    {i > 0 ? <IconeChevron width={14} height={14} className={`shrink-0 text-suave ${i === 1 && empresa ? 'lg:hidden' : ''}`} /> : null}
                    <span className={`truncate ${i === crumbs.length - 1 && crumbs.length === todasMigalhas.length ? 'font-semibold text-tinta' : 'text-suave'}`} {...(i === crumbs.length - 1 && crumbs.length === todasMigalhas.length ? { 'aria-current': 'page' as const } : {})}>{c.rotulo}</span>
                  </li>
                ))}
              </ol>
            </nav>
            <Sino naoLidasInicial={naoLidas} />
          </header>
          {cobranca?.aviso && !cobranca.bloqueado ? (
            <div role="status" className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm font-semibold ${cobranca.aviso.tom === 'risco' ? 'bg-risco-bg text-risco-fg' : cobranca.aviso.tom === 'atencao' ? 'bg-atencao-bg text-atencao-fg' : 'bg-marca-suave text-marca'}`}>
              {cobranca.aviso.texto}<Link href="/cobranca" className="underline">Plano e cobrança</Link>
            </div>
          ) : null}
          <main className={`mx-auto w-full max-w-5xl flex-1 space-y-3 px-4 pt-3 sm:px-5 sm:pt-4 ${soColaborador ? 'pb-24 lg:pb-10' : 'pb-10'}`}>{bloqueioAtivo ? <BloqueioCobranca texto={cobranca!.aviso?.texto ?? 'O acesso está suspenso por falta de pagamento.'} /> : <>{cabecalho ? <CabecalhoPagina titulo={cabecalho.rotulo} descricao={cabecalho.descricao} icone={cabecalho.icone} /> : null}{children}</>}</main>
          {soColaborador ? <BarraInferior secoes={secoes} pos={pos} /> : null}
        </div>
      </div>
    </>
  );
}

type PainelProps = {
  modo: 'completo' | 'rail'; naGaveta: boolean; secoes: SecaoMenu[]; pos: PosicaoMenu | null; grupoAberto: string | null; empresas: EmpresaDoMenu[]; empresaId: string | null; empresaNome: string | null;
  email: string; ehGestor: boolean; onGrupo: (id: string) => void; onRecolher: () => void; onFechar: () => void; onTrocarEmpresa: (id: string) => void;
};

function PainelMenu(p: PainelProps) {
  const rail = p.modo === 'rail';
  const inicial = (p.email.trim()[0] ?? '?').toUpperCase();
  return (
    <div className="flex h-full flex-col">
      <div className={`flex items-center gap-2 px-3 py-3 ${rail ? 'flex-col' : 'justify-between'}`}>
        <Link href="/" aria-label="JornadaCerta, início" className="flex min-w-0 items-center gap-2.5 rounded-lg px-1">
          <MarcaLogo tamanho={28} negativo />
          {!rail ? <span className="truncate font-[family-name:var(--font-titulo)] text-lg font-extrabold tracking-[-0.03em] text-white">JornadaCerta</span> : null}
        </Link>
        {p.naGaveta ? (
          <button type="button" onClick={p.onFechar} aria-label="Fechar o menu" className="grid size-10 place-items-center rounded-xl text-suave hover:bg-fundo"><IconeFechar /></button>
        ) : (
          <button type="button" onClick={p.onRecolher} aria-label={rail ? 'Expandir o menu' : 'Recolher o menu'} title={rail ? 'Expandir o menu' : 'Recolher o menu'} className="hidden size-9 place-items-center rounded-xl text-suave hover:bg-fundo lg:grid">
            {rail ? <IconeExpandir /> : <IconeRecolher />}
          </button>
        )}
      </div>

      {p.ehGestor && p.empresas.length > 0 ? (
        <div className={rail ? 'px-3 pb-2' : 'px-3 pb-3'}>
          {rail ? (
            <Dica rotulo={p.empresaNome ?? 'Escolher empresa'}>
              <span className={`grid size-11 place-items-center rounded-xl ${p.empresaId ? 'bg-marca-suave text-marca' : 'bg-fundo text-suave'}`}><IconeEmpresa /></span>
            </Dica>
          ) : (
            <label className="block text-xs font-semibold uppercase tracking-wide text-suave">
              Empresa
              <span className="relative mt-1 block">
                <IconeEmpresa width={18} height={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-marca" />
                <select value={p.empresaId ?? ''} onChange={(e) => p.onTrocarEmpresa(e.target.value)} aria-label="Trocar de empresa"
                  className="block min-h-11 w-full appearance-none truncate rounded-[10px] border border-linha bg-fundo py-2 pl-10 pr-8 text-sm font-semibold normal-case tracking-normal text-tinta">
                  {!p.empresaId ? <option value="">Escolha uma empresa…</option> : null}
                  {p.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
                <IconeChevron width={14} height={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-suave" />
              </span>
            </label>
          )}
        </div>
      ) : null}

      <nav aria-label="Menu principal" className={`min-h-0 flex-1 px-3 pb-3 ${rail ? 'overflow-visible' : 'overflow-y-auto overflow-x-hidden'}`}>
        {p.secoes.map((s, i) => (
          <div key={s.id} className={i > 0 ? 'mt-3' : ''}>
            {rail ? (i > 0 ? <hr className="mx-2 mb-2 border-linha" /> : null) : (s.id === 'empresa' && p.ehGestor && p.empresas.length > 0 ? null : <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-suave">{s.titulo}</p>)}
            <ul className="space-y-0.5">
              {s.grupos.map((g) => <li key={g.id}><Grupo g={g} rail={rail} pos={p.pos} aberto={p.grupoAberto === g.id} onAlternar={() => p.onGrupo(g.id)} /></li>)}
            </ul>
          </div>
        ))}
        {p.secoes.length === 0 ? <p className="px-3 text-sm text-suave">Nada para mostrar por aqui ainda.</p> : null}
      </nav>

      <div className={`border-t border-linha p-3 ${rail ? 'flex justify-center' : ''}`}>
        {rail ? (
          <Dica rotulo={p.email} lado="topo" extra={<div className="mt-2"><BotaoSair /></div>}>
            <span className="grid size-10 place-items-center rounded-full bg-marca text-sm font-bold text-sobre-marca">{inicial}</span>
          </Dica>
        ) : (
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-marca text-sm font-bold text-sobre-marca" aria-hidden>{inicial}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold" title={p.email}>{p.email}</span><span className="block text-xs text-suave">{p.ehGestor ? 'Gestão' : 'Colaborador'}</span></span>
            <BotaoSair />
          </div>
        )}
      </div>
    </div>
  );
}

function Grupo({ g, rail, pos, aberto, onAlternar }: { g: GrupoMenu; rail: boolean; pos: PosicaoMenu | null; aberto: boolean; onAlternar: () => void }) {
  const Icone = ICONES_MENU[g.icone];
  const ativoGrupo = pos?.grupoId === g.id;

  if (!g.itens) {
    const link = (
      <Link href={g.href!} aria-current={ativoGrupo ? 'page' : undefined} aria-label={rail ? g.rotulo : undefined} className={`${classeItem(ativoGrupo)} ${rail ? 'justify-center px-0' : ''}`}>
        <Barra ativo={ativoGrupo} /><Icone className={`shrink-0 ${corIcone(g.icone, ativoGrupo)}`} />{!rail ? <span className="truncate">{g.rotulo}</span> : null}
      </Link>
    );
    return rail ? <Dica rotulo={g.rotulo}>{link}</Dica> : link;
  }

  if (rail) {
    return (
      <Dica rotulo={g.rotulo} lista={g.itens} pos={pos}>
        <button type="button" aria-haspopup="true" aria-label={`${g.rotulo}: abrir submenu`} className={`${classeItem(ativoGrupo)} justify-center px-0`}><Barra ativo={ativoGrupo} /><Icone className={corIcone(g.icone, ativoGrupo)} /></button>
      </Dica>
    );
  }
  const idLista = `grupo-${g.id}`;
  return (
    <>
      <button type="button" onClick={onAlternar} aria-expanded={aberto} aria-controls={idLista} className={classeItem(ativoGrupo && !aberto)}>
        <Icone className={`shrink-0 ${corIcone(g.icone, ativoGrupo && !aberto)}`} /><span className="flex-1 truncate text-left">{g.rotulo}</span>
        <IconeChevron width={16} height={16} className={`shrink-0 text-suave transition-transform ${aberto ? 'rotate-90' : ''}`} />
      </button>
      {aberto ? (
        <ul id={idLista} className="ml-[1.35rem] mt-0.5 space-y-0.5 border-l border-linha pl-2.5">
          {g.itens.map((i) => <li key={i.id}>{i.secao ? <p className="px-2.5 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-suave">{i.secao}</p> : null}<SubItem i={i} ativo={pos?.itemId === i.id} /></li>)}
        </ul>
      ) : null}
    </>
  );
}

function SubItem({ i, ativo }: { i: ItemMenu; ativo: boolean }) {
  const Icone = ICONES_MENU[i.icone];
  return (
    <Link href={i.href} aria-current={ativo ? 'page' : undefined} className={`${classeItem(ativo)} min-h-8 gap-2 text-[13px]`}>
      <Icone width={16} height={16} className={`shrink-0 ${corIcone(i.icone, ativo)}`} /><span className="truncate">{i.rotulo}</span>
    </Link>
  );
}

const Barra = ({ ativo }: { ativo: boolean }) => (ativo ? <span aria-hidden className="absolute -left-3 top-2 bottom-2 w-1 rounded-r-full bg-marca" /> : null);

/** Dica do menu recolhido: rótulo (e, se houver, a lista de subitens) ao passar o mouse ou focar com o teclado. */
function Dica({ rotulo, children, lista, pos, extra, lado = 'direita' }: { rotulo: string; children: ReactNode; lista?: ItemMenu[]; pos?: PosicaoMenu | null; extra?: ReactNode; lado?: 'direita' | 'topo' }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="group relative">
      {children}
      <div className={`pointer-events-none absolute z-50 hidden pl-2 group-focus-within:pointer-events-auto group-focus-within:block group-hover:pointer-events-auto group-hover:block ${lado === 'topo' ? 'bottom-0 left-full' : 'left-full top-0'}`}>
        <div role={lista ? 'group' : 'tooltip'} aria-label={lista ? `Submenu ${rotulo}` : undefined} className="min-w-44 rounded-2xl border border-linha bg-cartao p-1.5 shadow-pop">
          <p className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-suave">{rotulo}</p>
          {lista ? <ul>{lista.map((i) => <li key={i.id}>{i.secao ? <p className="px-3 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-suave">{i.secao}</p> : null}<SubItem i={i} ativo={pos?.itemId === i.id} /></li>)}</ul> : null}
          {extra}
        </div>
      </div>
    </div>
  );
}

/** Barra de abas no celular para quem só é colaborador (o app instalado). */
function BarraInferior({ secoes, pos }: { secoes: SecaoMenu[]; pos: PosicaoMenu | null }) {
  const grupos = secoes.flatMap((s) => s.grupos).filter((g) => g.href);
  return (
    <nav aria-label="Atalhos" className="fixed inset-x-0 bottom-0 z-30 border-t border-linha bg-cartao pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
      <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${grupos.length}, minmax(0, 1fr))` }}>
        {grupos.map((g) => {
          const Icone = ICONES_MENU[g.icone]; const ativo = pos?.grupoId === g.id;
          return (
            <li key={g.id}>
              <Link href={g.href!} aria-current={ativo ? 'page' : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${ativo ? 'text-marca' : 'text-suave'}`}>
                <span className={`rounded-full px-4 py-0.5 ${ativo ? 'bg-marca-suave' : ''}`}><Icone /></span>{g.rotulo.replace('Meu banco de horas', 'Banco de horas').replace('Meus pedidos', 'Pedidos')}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Tela no lugar do conteúdo quando a conta está bloqueada (teste vencido, assinatura cancelada ou fatura vencida há muito). */
function BloqueioCobranca({ texto }: { texto: string }) {
  return (
    <div role="alert" className="mx-auto mt-8 max-w-lg space-y-3 rounded-2xl border border-linha bg-cartao p-6 text-center shadow-card">
      <h1 className="text-xl font-bold">Acesso suspenso</h1>
      <p className="text-sm text-suave">{texto}</p>
      <p className="text-sm text-suave">Seus dados estão guardados e voltam a aparecer assim que a assinatura for regularizada.</p>
      <Link href="/cobranca" className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-marca px-5 text-sm font-semibold text-sobre-marca hover:bg-marca-escuro">Ir para Plano e cobrança</Link>
    </div>
  );
}
