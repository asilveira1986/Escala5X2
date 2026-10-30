import type { Diagnostico } from '@jc/rules-engine';
import { data, decimal, horasMin, inteiro, moeda } from '@jc/documents/formatar';
import { resumoSimples } from '@/lib/resumo';
import { IconeAlerta, IconeCalendario, IconeCheck, IconePessoas, IconeEscudo } from './icones';
import { Cartao } from './ui';

function Bloco({ Icone, valor, rotulo, dica, tom }: { Icone: typeof IconeCheck; valor: string; rotulo: string; dica?: string; tom: 'ok' | 'atencao' | 'risco' | 'azul' }) {
  const cor = { ok: 'bg-ok-bg text-ok-fg', atencao: 'bg-atencao-bg text-atencao-fg', risco: 'bg-risco-bg text-risco-fg', azul: 'bg-marca-suave text-marca' }[tom];
  return (
    <div className="rounded-2xl border border-linha bg-cartao p-4">
      <span className={`grid size-9 place-items-center rounded-xl ${cor}`}><Icone width={20} height={20} /></span>
      <div className="mt-3 whitespace-nowrap font-[family-name:var(--font-titulo)] text-3xl font-bold leading-none">{valor}</div>
      <div className="mt-1.5 text-sm font-semibold">{rotulo}</div>
      {dica ? <div className="mt-0.5 text-xs text-suave">{dica}</div> : null}
    </div>
  );
}

/** Apresentação pura (sem hooks): frase-resumo, situação das pessoas, números de impacto e setores. */
export function PainelDiagnostico({ diagnostico: d }: { diagnostico: Diagnostico }) {
  const r = d.resumo;
  const c = r.porClassificacao;
  const s = resumoSimples(d);
  const grupos = [...d.grupos].sort((a, b) => b.horasPerdidasF2Min - a.horasPerdidasF2Min);
  return (
    <div className="space-y-4">
      <section aria-labelledby="resumo" className="rounded-3xl bg-marca-suave p-6 sm:p-8">
        <p className="text-sm font-semibold text-marca">Diagnóstico de {data(d.dataReferencia)}</p>
        <h2 id="resumo" className="mt-1 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">{s.titulo}</h2>
        {s.detalhe ? <p className="mt-2 max-w-2xl text-base text-tinta/80">{s.detalhe}</p> : null}
        <div className="mt-5 max-w-xl">
          <div className="flex justify-between text-sm font-semibold"><span>Já adequados</span><span>{s.percentualAdequado}%</span></div>
          <div role="img" aria-label={`${s.percentualAdequado}% das pessoas já estão adequadas`} className="mt-1.5 h-3 overflow-hidden rounded-full bg-cartao">
            <div className="h-full rounded-full bg-marca" style={{ width: `${s.percentualAdequado}%` }} />
          </div>
        </div>
        <p className="mt-4 text-xs text-suave">
          Fase 1: {data(d.fases.f1Inicio)} a {data(d.fases.f1Fim)}, até 42 horas por semana. Fase 2: a partir de {data(d.fases.f2Inicio)}, até 40 horas por semana.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Bloco Icone={IconeCheck} tom="ok" valor={inteiro(c.adequado)} rotulo="Já adequados" dica="Nada a fazer" />
        <Bloco Icone={IconeAlerta} tom="risco" valor={inteiro(c.adequacao_f1)} rotulo="Adequar na fase 1" dica={`Até ${data(d.fases.f1Inicio)}`} />
        <Bloco Icone={IconeCalendario} tom="atencao" valor={inteiro(c.adequacao_f2)} rotulo="Adequar na fase 2" dica={`Até ${data(d.fases.f2Inicio)}`} />
        <Bloco Icone={IconeEscudo} tom="azul" valor={inteiro(c.excecao)} rotulo="Com exceção" dica="Alta renda ou acordo coletivo" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Bloco Icone={IconePessoas} tom="azul" valor={inteiro(r.total)} rotulo="Pessoas analisadas" dica={`Folha de ${moeda(r.folhaMensalCentavos)} por mês`} />
        <Bloco Icone={IconeCalendario} tom="azul" valor={`${horasMin(r.horasPerdidasF1Min)} · ${horasMin(r.horasPerdidasF2Min)}`} rotulo="Horas por semana a cobrir" dica="Fase 1 · Fase 2" />
        <Bloco Icone={IconePessoas} tom="azul" valor={`${decimal(r.fteF1)} · ${decimal(r.fteF2)}`} rotulo="Pessoas a mais necessárias" dica="Fase 1 · Fase 2, em tempo integral" />
      </div>

      <Cartao titulo="Onde o impacto é maior" subtitulo="Setores e turnos ordenados pelo maior número de horas a cobrir na fase 2.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Horas a cobrir e pessoas necessárias por setor e turno</caption>
            <thead className="text-xs font-semibold uppercase tracking-wide text-suave">
              <tr><th className="py-2 pr-3">Setor</th><th className="pr-3">Turno</th><th className="pr-3 text-right">Pessoas</th><th className="pr-3 text-right">Fase 1</th><th className="pr-3 text-right">Fase 2</th><th className="pr-3 text-right">Contratar F1</th><th className="text-right">Contratar F2</th></tr>
            </thead>
            <tbody>
              {grupos.map((g, i) => (
                <tr key={i} className="border-t border-linha">
                  <td className="py-2.5 pr-3 font-semibold">{g.setor ?? '—'}</td><td className="pr-3">{g.turno ?? '—'}</td>
                  <td className="pr-3 text-right">{inteiro(g.colaboradores)}</td>
                  <td className="pr-3 text-right">{horasMin(g.horasPerdidasF1Min)}</td><td className="pr-3 text-right">{horasMin(g.horasPerdidasF2Min)}</td>
                  <td className="pr-3 text-right">{decimal(g.fteF1)}</td><td className="text-right">{decimal(g.fteF2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-suave">Horas por semana que deixam de ser trabalhadas. A divisão por dia da semana é uma estimativa uniforme entre os dias de operação.</p>
      </Cartao>
    </div>
  );
}
