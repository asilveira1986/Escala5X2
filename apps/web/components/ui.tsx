import type { ButtonHTMLAttributes, ReactNode } from 'react';

const base = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

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

export const classeCampo = 'mt-1.5 block min-h-11 w-full rounded-xl border border-linha bg-cartao px-3.5 py-2 text-sm text-tinta placeholder:text-suave';

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
    <section className={`rounded-2xl border border-linha bg-cartao p-5 shadow-[0_1px_2px_rgba(16,32,30,0.04)] sm:p-6 ${className}`}>
      {titulo ? <h2 className="text-lg font-bold">{titulo}</h2> : null}
      {subtitulo ? <p className="mt-1 text-sm text-suave">{subtitulo}</p> : null}
      {titulo || subtitulo ? <div className="mt-4">{children}</div> : children}
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
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tons[tom]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok'; children: ReactNode }) {
  const c = { info: tons.azul, erro: tons.vermelho, ok: tons.verde }[tipo];
  return <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm font-medium ${c}`}>{children}</div>;
}

export function Titulo({ children, descricao }: { children: ReactNode; descricao?: string }) {
  return (
    <div>
      <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{children}</h1>
      {descricao ? <p className="mt-1.5 max-w-2xl text-suave">{descricao}</p> : null}
    </div>
  );
}
