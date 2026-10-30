import Link from 'next/link';
import { IconeCheck } from './icones';

export type Passo = { rotulo: string; descricao: string; feito: boolean; href?: string };

/** Mostra onde a pessoa está e qual é o próximo passo. O primeiro passo pendente fica em destaque. */
export function PassoAPasso({ passos }: { passos: Passo[] }) {
  const proximo = passos.findIndex((p) => !p.feito);
  return (
    <ol className="grid gap-2.5 sm:grid-cols-3" aria-label="Passo a passo">
      {passos.map((p, i) => {
        const atual = i === proximo;
        const conteudo = (
          <>
            <span className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${p.feito ? 'bg-marca text-sobre-marca' : atual ? 'bg-destaque text-[#10201e]' : 'bg-neutro-bg text-neutro-fg'}`}>
              {p.feito ? <IconeCheck width={18} height={18} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold">{p.rotulo}{p.feito ? <span className="sr-only"> (concluído)</span> : atual ? <span className="sr-only"> (próximo passo)</span> : null}</span>
              <span className="block text-xs text-suave">{p.descricao}</span>
            </span>
          </>
        );
        const classe = `flex items-start gap-2.5 rounded-2xl border p-3 ${atual ? 'border-marca bg-marca-suave' : 'border-linha bg-cartao'}`;
        return (
          <li key={p.rotulo} aria-current={atual ? 'step' : undefined}>
            {p.href && !p.feito ? <Link href={p.href} className={`${classe} hover:border-marca`}>{conteudo}</Link> : <div className={classe}>{conteudo}</div>}
          </li>
        );
      })}
    </ol>
  );
}
