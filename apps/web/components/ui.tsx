import type { ButtonHTMLAttributes, ReactNode } from 'react';

const base = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9';

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

export const classeCampo = 'mt-1 block min-h-11 w-full rounded-xl border border-linha bg-cartao px-3 py-1.5 text-sm sm:min-h-9 text-tinta placeholder:text-suave';

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="block text-sm font-semibold">
      {rotulo}
      {children}
      {dica ? <span className="mt-1 block text-xs font-normal text-suave">{dica}</span> : null}
    </label>
  );
}

export function Cartao({ titulo, subtitulo, children, className = '' }: { titulo?: string; subtitulo?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-linha bg-cartao p-4 shadow-[0_2px_8px_rgba(16,32,30,0.05)] sm:p-5 ${className}`}>
      {titulo ? <h2 className="text-base font-bold">{titulo}</h2> : null}
      {subtitulo ? <p className="mt-0.5 text-sm text-suave">{subtitulo}</p> : null}
      {titulo || subtitulo ? <div className="mt-3">{children}</div> : children}
    </section>
  );
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

export function Titulo({ children, descricao }: { children: ReactNode; descricao?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{children}</h1>
      {descricao ? <p className="mt-1 max-w-2xl text-suave">{descricao}</p> : null}
    </div>
  );
}
