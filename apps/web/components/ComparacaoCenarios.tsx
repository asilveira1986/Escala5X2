import type { ResultadoCenario } from '@jc/rules-engine';
import { inteiro, moeda, ROTULO_CENARIO } from '@jc/documents/formatar';
import { Selo } from './ui';

export type CenarioListado = { id?: string; nome: string; resultado: ResultadoCenario };

/** Comparação lado a lado. Destaca o menor custo anual entre os cenários calculados (não bloqueados). */
export function ComparacaoCenarios({ cenarios }: { cenarios: CenarioListado[] }) {
  if (cenarios.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">Nenhum cenário simulado ainda.</p>;
  const validos = cenarios.filter((c) => !c.resultado.bloqueado);
  const menor = validos.length ? Math.min(...validos.map((c) => c.resultado.custoAnualCentavos)) : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Comparação de cenários de correção</caption>
        <thead className="border-b border-slate-200 text-xs uppercase text-slate-600 dark:border-slate-800 dark:text-slate-400">
          <tr><th className="py-2 pr-3">Cenário</th><th className="pr-3">Fase</th><th className="pr-3 text-right">Custo mensal</th><th className="pr-3 text-right">Custo anual</th><th className="pr-3 text-right">Contratações</th><th>Observações</th></tr>
        </thead>
        <tbody>
          {cenarios.map((c, i) => {
            const r = c.resultado;
            const melhor = !r.bloqueado && r.custoAnualCentavos === menor && validos.length > 1;
            return (
              <tr key={c.id ?? i} className="border-b border-slate-100 align-top dark:border-slate-800">
                <td className="py-2 pr-3 font-medium">{c.nome || ROTULO_CENARIO[r.tipo]} {melhor ? <Selo tom="verde">Menor custo</Selo> : null}</td>
                <td className="pr-3">{r.fase}</td>
                <td className="whitespace-nowrap pr-3 text-right">{r.bloqueado ? <Selo tom="vermelho">Bloqueado</Selo> : moeda(r.custoMensalCentavos)}</td>
                <td className="whitespace-nowrap pr-3 text-right">{r.bloqueado ? '—' : moeda(r.custoAnualCentavos)}</td>
                <td className="pr-3 text-right">{inteiro(r.contratacoes)}</td>
                <td className="text-xs text-slate-600 dark:text-slate-400">{r.alertas.join(' ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
