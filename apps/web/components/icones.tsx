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

/** Marca Jornada: anel de progresso (a jornada do dia se completando) com o ponto ciano no centro. Cores fixas do logotipo; `negativo` é a versão para fundo Azul Noite. */
export function MarcaLogo({ tamanho = 28, negativo = false }: { tamanho?: number; negativo?: boolean }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill={negativo ? '#3d73ff' : '#1f5eff'} />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="6" />
      <path d="M32 15 A17 17 0 1 1 15 32" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
      <path d="M32 32 L32 23" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4.5" fill="#22d3ee" />
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

// ---- ícones do menu lateral
export const IconeChevron = (p: P) => <svg {...base} {...p}><path d="M9 6l6 6-6 6" /></svg>;
export const IconeMenu = (p: P) => <svg {...base} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
export const IconeFechar = (p: P) => <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IconeRecolher = (p: P) => <svg {...base} {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15M15.5 9.5L13 12l2.5 2.5" /></svg>;
export const IconeExpandir = (p: P) => <svg {...base} {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.5 4.5v15M13 9.5l2.5 2.5-2.5 2.5" /></svg>;
export const IconeInicio = (p: P) => <svg {...base} {...p}><path d="M4 11l8-6.5 8 6.5v8a1.5 1.5 0 01-1.5 1.5H15v-5.5H9V20H5.5A1.5 1.5 0 014 18.5V11z" /></svg>;
export const IconeCarteira = (p: P) => <svg {...base} {...p}><rect x="3.5" y="7.5" width="17" height="12" rx="3" /><path d="M9 7.5V6a2 2 0 012-2h2a2 2 0 012 2v1.5M3.5 12.5h17" /></svg>;
export const IconeTurnos = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
export const IconeCobertura = (p: P) => <svg {...base} {...p}><path d="M12 4l8 4-8 4-8-4 8-4z" /><path d="M4 12l8 4 8-4M4 16l8 4 8-4" /></svg>;
export const IconeFerias = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="3.6" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" /></svg>;
export const IconePedidos = (p: P) => <svg {...base} {...p}><path d="M4 13l2.2-6.6A2 2 0 018.1 5h7.8a2 2 0 011.9 1.4L20 13v4.5A1.5 1.5 0 0118.5 19h-13A1.5 1.5 0 014 17.5V13z" /><path d="M4 13h4.2a1.5 1.5 0 011.3.8l.5.9a1.5 1.5 0 001.3.8h1.4a1.5 1.5 0 001.3-.8l.5-.9a1.5 1.5 0 011.3-.8H20" /></svg>;
export const IconeRelogio = (p: P) => <svg {...base} {...p}><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 1.5M9.5 3.5h5" /></svg>;
export const IconeBanco = (p: P) => <svg {...base} {...p}><path d="M4 9.5l8-5 8 5M5.5 10v7.5M10 10v7.5M14 10v7.5M18.5 10v7.5M3.5 19.5h17" /></svg>;
export const IconeFolha = (p: P) => <svg {...base} {...p}><path d="M7 3.5h7l4.5 4.5v11A1.5 1.5 0 0117 20.5H7A1.5 1.5 0 015.5 19V5A1.5 1.5 0 017 3.5z" /><path d="M14 3.5V8h4.5M9 12.5h6M9 16h6" /></svg>;
export const IconeSair = (p: P) => <svg {...base} {...p}><path d="M14 4.5h3.5A1.5 1.5 0 0119 6v12a1.5 1.5 0 01-1.5 1.5H14M10.5 8L6.5 12l4 4M6.5 12H16" /></svg>;

export const IconeConfig = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
export const IconeMais = (p: P) => <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const IconeSino = (p: P) => <svg {...base} {...p}><path d="M6 16.5V11a6 6 0 1112 0v5.5l1.5 1.5h-15L6 16.5zM10 20.5a2 2 0 004 0" /></svg>;
