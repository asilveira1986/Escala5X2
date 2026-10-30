import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconeCheck = (p: P) => <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const IconeAlerta = (p: P) => <svg {...base} {...p}><path d="M12 4l9 16H3L12 4z" /><path d="M12 10v4M12 17.2v.1" /></svg>;
export const IconePessoas = (p: P) => <svg {...base} {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3 3-4.6 6-4.6s5.4 1.6 6 4.6" /><path d="M16 5.2a3 3 0 010 5.6M18 14.6c1.8.6 2.7 2 3 4.4" /></svg>;
export const IconeEnviar = (p: P) => <svg {...base} {...p}><path d="M12 16V5M7.5 9.5L12 5l4.5 4.5" /><path d="M5 15v3.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V15" /></svg>;
export const IconeCalendario = (p: P) => <svg {...base} {...p}><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M8 3.5v4M16 3.5v4M4 10.5h16" /></svg>;
export const IconeGrafico = (p: P) => <svg {...base} {...p}><path d="M5 20V10M12 20V4M19 20v-7" /></svg>;
export const IconeEmpresa = (p: P) => <svg {...base} {...p}><path d="M4 20V6.5L12 4v16M12 9l8 2v9M3 20h18" /><path d="M7.5 9h1M7.5 12.5h1M7.5 16h1" /></svg>;
export const IconeSeta = (p: P) => <svg {...base} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const IconeBaixar = (p: P) => <svg {...base} {...p}><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19.5h14" /></svg>;
export const IconeEscudo = (p: P) => <svg {...base} {...p}><path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1l7-2.6z" /><path d="M9 12l2.2 2.2L15.5 10" /></svg>;

/** Marca: um calendário de semana com dois dias de folga destacados (o "2" do 5x2). */
export function MarcaLogo({ tamanho = 28 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--c-marca)" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={5 + i * 4.8} y="9" width="3.6" height="14" rx="1.8" fill="var(--c-sobre-marca)" opacity="0.92" />)}
      <rect x="25" y="9" width="3.6" height="14" rx="1.8" fill="var(--c-destaque)" />
    </svg>
  );
}

/** Ilustração simples para telas vazias: uma semana com dois dias de folga. */
export function IlustracaoVazia({ tamanho = 96 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 96 96" aria-hidden>
      <circle cx="48" cy="48" r="44" fill="var(--c-marca-suave)" />
      <rect x="16" y="26" width="64" height="48" rx="12" fill="var(--c-cartao)" stroke="var(--c-linha)" strokeWidth="2" />
      <rect x="16" y="26" width="64" height="14" rx="12" fill="var(--c-marca)" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={23 + i * 9.2} y="48" width="6.4" height="18" rx="3.2" fill="var(--c-marca)" opacity="0.85" />)}
      <rect x="69" y="48" width="6.4" height="18" rx="3.2" fill="var(--c-destaque)" />
      <circle cx="73" cy="22" r="7" fill="var(--c-destaque)" />
    </svg>
  );
}
