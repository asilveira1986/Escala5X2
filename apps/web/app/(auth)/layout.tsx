import type { ReactNode } from 'react';
import { IconeCheck, MarcaLogo } from '@/components/icones';

const pontos = ['Diagnóstico da nova escala em minutos, direto da sua planilha', 'Custo de cada solução, lado a lado, sem surpresa', 'Nenhum cenário reduz salário: o sistema bloqueia'];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <aside className="hidden flex-col justify-between bg-marca p-10 text-sobre-marca lg:flex" aria-hidden="false">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-cartao p-1"><MarcaLogo tamanho={32} /></span>
          <span className="font-[family-name:var(--font-titulo)] text-2xl font-bold">JornadaCerta</span>
        </div>
        <div>
          <p className="max-w-md font-[family-name:var(--font-titulo)] text-5xl font-bold leading-[1.05]">Escala 5x2 sem complicação.</p>
          <ul className="mt-8 max-w-md space-y-4">
            {pontos.map((p) => (
              <li key={p} className="flex items-start gap-3 text-lg">
                <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-destaque text-[#10201e]"><IconeCheck width={14} height={14} strokeWidth={3} /></span>{p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm opacity-80">Para empresas, escritórios de contabilidade e advogados trabalhistas.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden"><MarcaLogo tamanho={32} /><span className="font-[family-name:var(--font-titulo)] text-xl font-bold">JornadaCerta</span></div>
          {children}
        </div>
      </main>
    </div>
  );
}
