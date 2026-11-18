import Link from 'next/link';
import { hrefDaAba, type Aba } from '@/lib/abas';

/** Abas de uma tela, por endereço (?aba=): cada aba é uma página leve, funciona sem JavaScript e dá para compartilhar o link. */
export function Abas({ abas, atual, base, extras, rotulo = 'Seções da página' }: { abas: Aba[]; atual: string; base: string; extras?: Record<string, string | undefined>; rotulo?: string }) {
  return (
    <nav aria-label={rotulo} className="-mx-1 overflow-x-auto px-1">
      <ul className="inline-flex min-w-full gap-1 rounded-xl border border-linha bg-cartao p-1 sm:min-w-0">
        {abas.map((a) => {
          const ativa = a.id === atual;
          return (
            <li key={a.id}>
              <Link href={hrefDaAba(base, abas, a.id, extras)} aria-current={ativa ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors ${ativa ? 'bg-marca text-sobre-marca' : 'text-suave hover:bg-marca-suave hover:text-marca'}`}>
                {a.rotulo}
                {a.contagem !== undefined && a.contagem > 0 ? <span className={`rounded-full px-1.5 text-[11px] ${ativa ? 'bg-sobre-marca/20' : 'bg-neutro-bg text-neutro-fg'}`}>{a.contagem}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
