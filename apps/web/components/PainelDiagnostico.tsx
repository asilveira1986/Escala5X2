import type { Diagnostico } from '@jc/rules-engine';
import { data, decimal, horasMin, inteiro, moeda } from '@jc/documents/formatar';
import { Cartao } from './ui';

const KPI = ({ valor, rotulo, destaque }: { valor: string; rotulo: string; destaque?: boolean }) => (
  <div className={`rounded-lg border p-3 ${destaque ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950' : 'border-slate-200 dark:border-slate-800'}`}>
    <div className="whitespace-nowrap text-xl font-bold md:text-2xl">{valor}</div>
    <div className="text-xs text-slate-600 dark:text-slate-400">{rotulo}</div>
  </div>
);

/** Apresentação pura (sem hooks): resumo, fases e impacto por setor/turno. */
export function PainelDiagnostico({ diagnostico: d }: { diagnostico: Diagnostico }) {
  const r = d.resumo;
  const c = r.porClassificacao;
  const grupos = [...d.grupos].sort((a, b) => b.horasPerdidasF2Min - a.horasPerdidasF2Min);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Data de referência {data(d.dataReferencia)} · Fase 1: {data(d.fases.f1Inicio)} a {data(d.fases.f1Fim)} (até 42h semanais) · Fase 2: a partir de {data(d.fases.f2Inicio)} (até 40h semanais)
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI valor={inteiro(r.total)} rotulo="Colaboradores analisados" />
        <KPI valor={inteiro(c.adequado)} rotulo="Já adequados" />
        <KPI valor={inteiro(c.adequacao_f1)} rotulo="Adequar na fase 1" destaque={c.adequacao_f1 > 0} />
        <KPI valor={inteiro(c.adequacao_f2)} rotulo="Adequar na fase 2" />
        <KPI valor={inteiro(c.excecao)} rotulo="Exceções (alta renda ou acordo)" />
        <KPI valor={moeda(r.folhaMensalCentavos)} rotulo="Folha mensal analisada" />
        <KPI valor={`${horasMin(r.horasPerdidasF1Min)} / ${horasMin(r.horasPerdidasF2Min)}`} rotulo="Déficit semanal de cobertura (F1 / F2)" />
        <KPI valor={`${decimal(r.fteF1)} / ${decimal(r.fteF2)}`} rotulo="Equivalente em pessoas, FTE (F1 / F2)" />
      </div>
      <Cartao titulo="Impacto por setor e turno">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Déficit de cobertura e equivalente em pessoas por setor e turno</caption>
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <tr><th className="py-2 pr-3">Setor</th><th className="pr-3">Turno</th><th className="pr-3 text-right">Colaboradores</th><th className="pr-3 text-right">Déficit F1</th><th className="pr-3 text-right">Déficit F2</th><th className="pr-3 text-right">FTE F1</th><th className="text-right">FTE F2</th></tr>
            </thead>
            <tbody>
              {grupos.map((g, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3">{g.setor ?? '—'}</td><td className="pr-3">{g.turno ?? '—'}</td>
                  <td className="pr-3 text-right">{inteiro(g.colaboradores)}</td>
                  <td className="pr-3 text-right">{horasMin(g.horasPerdidasF1Min)}</td><td className="pr-3 text-right">{horasMin(g.horasPerdidasF2Min)}</td>
                  <td className="pr-3 text-right">{decimal(g.fteF1)}</td><td className="text-right">{decimal(g.fteF2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">Déficit em horas semanais de cobertura perdidas. A distribuição por dia da semana é estimada de forma uniforme entre os dias de operação.</p>
      </Cartao>
    </div>
  );
}
