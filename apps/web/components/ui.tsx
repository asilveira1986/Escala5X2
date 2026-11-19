import type { IconeId, TomCor } from '@/lib/menu';
import { ICONES_MENU } from './menu-icones';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const base = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-3.5 py-1 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8';

export function Botao({ variante = 'primario', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'perigo' }) {
  const cores = {
    primario: 'bg-marca text-sobre-marca hover:bg-marca-escuro',
    secundario: 'border border-linha bg-cartao text-tinta hover:bg-marca-suave',
    perigo: 'bg-risco-fg text-cartao hover:opacity-90',
  }[variante];
  return <button {...p} className={`${base} ${cores} ${className}`} />;
}

/** Classe de link com aparência de botão (para <a> e <Link>). */
export const classeBotaoLink = `${base} border border-linha bg-cartao text-tinta hover:bg-marca-suave`;
export const classeBotaoLinkPrimario = `${base} bg-marca text-sobre-marca hover:bg-marca-escuro`;

export const classeCampo = 'mt-1 block min-h-11 w-full rounded-[10px] border border-linha bg-cartao px-2.5 py-1 text-[13px] sm:min-h-8 text-tinta placeholder:text-suave';

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="block text-sm font-semibold">
      {rotulo}
      {children}
      {dica ? <span className="mt-1 block text-xs font-normal text-suave">{dica}</span> : null}
    </label>
  );
}

/** Quadradinho colorido com o ícone (cabeçalhos, cartões, métricas). */
export const COR_TOM: Record<TomCor | 'ok' | 'atencao' | 'risco', string> = {
  marca: 'bg-marca-suave text-marca', azul: 'bg-azul-bg text-azul-fg', violeta: 'bg-violeta-bg text-violeta-fg', verde: 'bg-verde-bg text-verde-fg',
  ambar: 'bg-ambar-bg text-ambar-fg', rosa: 'bg-rosa-bg text-rosa-fg', neutro: 'bg-neutro-bg text-neutro-fg', ok: 'bg-ok-bg text-ok-fg', atencao: 'bg-atencao-bg text-atencao-fg', risco: 'bg-risco-bg text-risco-fg',
};
type TomIcone = keyof typeof COR_TOM;
const COR_BARRA: Record<TomIcone, string> = { marca: 'bg-marca', azul: 'bg-azul-fg', violeta: 'bg-violeta-fg', verde: 'bg-verde-fg', ambar: 'bg-ambar-fg', rosa: 'bg-rosa-fg', neutro: 'bg-neutro-fg', ok: 'bg-ok-fg', atencao: 'bg-atencao-fg', risco: 'bg-risco-fg' };

/** Quadradinho colorido com o ícone. Sem `tom`, usa a cor da área a que o ícone pertence. */
export function IconeCaixa({ icone, tom, tamanho = 'md' }: { icone: IconeId; tom?: TomIcone; tamanho?: 'sm' | 'md' | 'lg' }) {
  const I = ICONES_MENU[icone];
  const dim = { sm: 'size-7 rounded-lg', md: 'size-8 rounded-xl', lg: 'size-9 rounded-xl' }[tamanho];
  return <span aria-hidden className={`grid shrink-0 place-items-center ${dim} ${COR_TOM[tom ?? 'marca']}`}><I width={tamanho === 'sm' ? 16 : 18} height={tamanho === 'sm' ? 16 : 18} /></span>;
}

export function Cartao({ titulo, subtitulo, icone, acoes, children, className = '' }: { titulo?: string; subtitulo?: string; icone?: IconeId; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-linha bg-cartao p-3.5 shadow-card sm:p-4 ${className}`}>
      {titulo || subtitulo || acoes ? (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
          <div className="flex min-w-0 items-start gap-2.5">
            {icone ? <IconeCaixa icone={icone} tamanho="sm" /> : null}
            <div className="min-w-0">
              {titulo ? <h2 className="text-[15px] font-bold leading-7">{titulo}</h2> : null}
              {subtitulo ? <p className={`text-[13px] text-suave ${titulo ? '-mt-1' : ''}`}>{subtitulo}</p> : null}
            </div>
          </div>
          {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Cabeçalho de página: ícone, título, descrição e, à direita, as ações da tela. */
export function CabecalhoPagina({ titulo, descricao, icone, acoes, children }: { titulo: ReactNode; descricao?: string; icone?: IconeId; acoes?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-start gap-3">
        {icone ? <IconeCaixa icone={icone} tamanho="lg" /> : null}
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight tracking-tight">{titulo}</h1>
          {descricao ? <p className="max-w-2xl text-[13px] text-suave">{descricao}</p> : null}
          {children}
        </div>
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </div>
  );
}

/** Número em destaque com ícone, para resumos. Vira link quando recebe `href`. */
export function Metrica({ icone, rotulo, valor, texto, tom, href }: { icone: IconeId; rotulo: string; valor: number | string; texto?: string; tom?: TomIcone; href?: string }) {
  const barra = COR_BARRA[tom ?? 'marca'];
  const corpo = (
    <>
      <span aria-hidden className={`absolute inset-x-5 top-0 h-1 rounded-b-full opacity-70 ${barra}`} />
      <div className="flex items-center justify-between gap-3">
        <span className="rotulo-col truncate !tracking-[0.05em]" title={rotulo}>{rotulo}</span>
        <IconeCaixa icone={icone} tom={tom} tamanho="sm" />
      </div>
      <span className="horario mt-1.5 block text-xl font-bold leading-none tracking-tight">{valor}</span>
      {texto ? <span className="mt-1 block text-xs text-suave">{texto}</span> : null}
    </>
  );
  const cls = 'relative block overflow-hidden rounded-2xl border border-linha bg-cartao p-3 shadow-card sm:p-3.5';
  return href ? <a href={href} className={`${cls} transition hover:-translate-y-0.5 hover:border-marca hover:shadow-pop`}>{corpo}</a> : <div className={cls}>{corpo}</div>;
}

const tons = {
  verde: 'bg-ok-bg text-ok-fg',
  amarelo: 'bg-atencao-bg text-atencao-fg',
  vermelho: 'bg-risco-bg text-risco-fg',
  azul: 'bg-marca-suave text-marca',
  cinza: 'bg-neutro-bg text-neutro-fg',
} as const;

/** Etiqueta de estado. O ponto e o texto carregam o significado; a cor só reforça. */
export function Selo({ tom, children }: { tom: keyof typeof tons; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tons[tom]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok'; children: ReactNode }) {
  const c = { info: tons.azul, erro: tons.vermelho, ok: tons.verde }[tipo];
  return <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-2xl px-3.5 py-2 text-sm font-medium ${c}`}>{children}</div>;
}

export function Titulo({ children, descricao, icone, acoes }: { children: ReactNode; descricao?: string; icone?: IconeId; acoes?: ReactNode }) {
  return <CabecalhoPagina titulo={children} descricao={descricao} icone={icone} acoes={acoes} />;
}
