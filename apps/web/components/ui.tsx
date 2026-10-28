import type { ButtonHTMLAttributes, ReactNode } from 'react';

const base = 'inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50';

export function Botao({ variante = 'primario', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'perigo' }) {
  const cores = {
    primario: 'bg-blue-700 text-white hover:bg-blue-800',
    secundario: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
    perigo: 'bg-red-700 text-white hover:bg-red-800',
  }[variante];
  return <button {...p} className={`${base} ${cores} ${className}`} />;
}

export const classeCampo = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900';

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="block text-sm font-medium">
      {rotulo}
      {children}
      {dica ? <span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-400">{dica}</span> : null}
    </label>
  );
}

export function Cartao({ titulo, children, className = '' }: { titulo?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {titulo ? <h2 className="mb-3 text-base font-semibold">{titulo}</h2> : null}
      {children}
    </section>
  );
}

const tons = {
  verde: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  amarelo: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  vermelho: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  azul: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  cinza: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
} as const;

export function Selo({ tom, children }: { tom: keyof typeof tons; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tons[tom]}`}>{children}</span>;
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok'; children: ReactNode }) {
  const c = { info: tons.azul, erro: tons.vermelho, ok: tons.verde }[tipo];
  return <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-md p-3 text-sm ${c}`}>{children}</div>;
}
