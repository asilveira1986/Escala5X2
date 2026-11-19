import type { ReactNode } from 'react';
import { IconeCheck, MarcaLogo } from '@/components/icones';

const pontos = ['Diagnóstico da nova escala em minutos, direto da sua planilha', 'Custo de cada solução, lado a lado, sem surpresa', 'Nenhum cenário reduz salário: o sistema bloqueia'];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-noite p-10 text-white lg:flex" aria-hidden="false">
        <svg aria-hidden viewBox="0 0 200 200" className="pointer-events-none absolute -bottom-24 -right-24 size-[28rem]"><circle cx="100" cy="100" r="80" fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="22" /><circle cx="100" cy="100" r="80" fill="none" stroke="#1f5eff" strokeWidth="22" strokeLinecap="round" strokeDasharray="330 503" transform="rotate(-90 100 100)" /><circle cx="100" cy="100" r="14" fill="#22d3ee" /></svg>
        <div className="flex items-center gap-3">
          <MarcaLogo tamanho={36} negativo />
          <span className="font-[family-name:var(--font-titulo)] text-2xl font-extrabold tracking-[-0.03em]">JornadaCerta</span>
        </div>
        <div className="relative">
          <p className="max-w-md font-[family-name:var(--font-titulo)] text-5xl font-extrabold leading-[1.05] tracking-[-0.02em]">Escala 5x2 sem complicação.</p>
          <ul className="mt-8 max-w-md space-y-4">
            {pontos.map((p) => (
              <li key={p} className="flex items-start gap-3 text-lg">
                <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-destaque text-noite"><IconeCheck width={14} height={14} strokeWidth={3} /></span>{p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-[#9fb0d4]">Para empresas, escritórios de contabilidade e advogados trabalhistas.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden"><MarcaLogo tamanho={32} /><span className="font-[family-name:var(--font-titulo)] text-xl font-extrabold tracking-[-0.03em]">JornadaCerta</span></div>
          {children}
        </div>
      </main>
    </div>
  );
}
