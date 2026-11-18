'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Cartao, classeBotaoLink, classeCampo } from '@/components/ui';
import { compararCustos, type Prontidao as DadosProntidao } from '@/lib/prontidao';
import { data as dataBr, decimal, horasMin, inteiro, moeda } from '@jc/documents/formatar';
import type { Diagnostico } from '@jc/rules-engine';

const num = (v: string, max: number) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0; };

function Medidor({ titulo, inicio, dias, pronto, total, pct }: { titulo: string; inicio: string; dias: number; pronto: number; total: number; pct: number }) {
  const prazo = dias > 0 ? `faltam ${inteiro(dias)} dia${dias === 1 ? '' : 's'}` : 'em vigor';
  const cor = pct >= 100 ? 'bg-ok-fg' : dias <= 45 && pct < 100 ? 'bg-risco-fg' : 'bg-marca';
  return (
    <div className="rounded-2xl border border-linha bg-cartao p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{titulo}</p>
        <p className={`text-xs font-semibold ${dias > 0 && dias <= 45 && pct < 100 ? 'text-risco-fg' : 'text-suave'}`}>{dataBr(inicio)} · {prazo}</p>
      </div>
      <p className="mt-2 text-3xl font-bold leading-none tracking-tight">{pct}%<span className="ml-2 text-sm font-medium text-suave">prontos</span></p>
      <div role="img" aria-label={`${pct}% das pessoas prontas para a ${titulo}`} className="mt-3 h-2.5 overflow-hidden rounded-full bg-fundo"><div className={`h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} /></div>
      <p className="mt-2 text-xs text-suave">{inteiro(pronto)} de {inteiro(total)} pessoas já atendem a jornada e as folgas desta fase.</p>
    </div>
  );
}

export function Prontidao({ empresaId, d, p }: { empresaId: string; d: Diagnostico; p: DadosProntidao }) {
  const [encargos, setEncargos] = useState('0');
  const [he, setHe] = useState('50');
  const [contratacao, setContratacao] = useState('0');
  const custos = useMemo(() => compararCustos(d, { encargosPct: Math.min(num(encargos, 200), 200), adicionalHePct: Math.max(50, Math.min(num(he, 300), 300)), custoContratacaoCentavos: Math.round(num(contratacao, 1_000_000) * 100) }), [d, encargos, he, contratacao]);
  const tudoPronto = p.prontosF2 === p.total;
  const base = `/empresas/${empresaId}`;
  return (
    <div className="space-y-4">
      <section aria-label="Prontidão por fase" className="grid gap-3 md:grid-cols-2">
        <Medidor titulo="Fase 1 · 42h" inicio={p.f1Inicio} dias={p.diasF1} pronto={p.prontosF1} total={p.total} pct={p.pctF1} />
        <Medidor titulo="Fase 2 · 40h" inicio={p.f2Inicio} dias={p.diasF2} pronto={p.prontosF2} total={p.total} pct={p.pctF2} />
      </section>

      <Cartao icone="pessoas" titulo="Prontidão por setor" subtitulo="Quem precisa mudar de jornada e quantas pessoas a mais a cobertura exige (em tempo integral).">
        {p.setores.length === 0 ? <p className="text-sm text-suave">Cadastre colaboradores com contrato para ver a prontidão.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm" aria-label="Prontidão por setor">
              <thead className="text-xs font-semibold uppercase tracking-wide text-suave"><tr><th className="pb-1.5 pr-3">Setor</th><th className="pb-1.5 pr-3 text-right">Pessoas</th><th className="pb-1.5 pr-3 text-right">A adequar F1 · F2</th><th className="pb-1.5 pr-3 text-right">Horas a cobrir (F2)</th><th className="pb-1.5 pr-3 text-right">Pessoas a mais F1 · F2</th><th className="pb-1.5">Situação</th></tr></thead>
              <tbody className="divide-y divide-linha">
                {p.setores.map((s) => (
                  <tr key={s.setor}>
                    <td className="py-2 pr-3 font-semibold">{s.setor}</td>
                    <td className="py-2 pr-3 text-right">{inteiro(s.pessoas)}</td>
                    <td className="py-2 pr-3 text-right">{inteiro(s.afetadosF1)} · {inteiro(s.afetadosF2)}</td>
                    <td className="py-2 pr-3 text-right">{horasMin(s.horasPerdidasF2Min)}/sem</td>
                    <td className="py-2 pr-3 text-right">{decimal(s.fteF1)} · {decimal(s.fteF2)}</td>
                    <td className="py-2"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.prontoF2 ? 'bg-ok-bg text-ok-fg' : s.prontoF1 ? 'bg-atencao-bg text-atencao-fg' : 'bg-risco-bg text-risco-fg'}`}>{s.prontoF2 ? 'Pronto' : s.prontoF1 ? 'Pronto na fase 1' : 'Adequar já'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <Cartao icone="folha" titulo="Quanto custa cobrir as horas" subtitulo="Compara cobrir com horas extras ou com contratação, em tempo real. Salário não é reduzido em nenhum cenário.">
        {tudoPronto ? <p className="text-sm text-ok-fg">Nenhuma hora a cobrir: toda a equipe já atende as duas fases.</p> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold">Encargos (%)<input type="number" min={0} max={200} step="any" inputMode="decimal" value={encargos} onChange={(e) => setEncargos(e.target.value)} aria-label="Encargos (%)" className={`${classeCampo} mt-1`} /><span className="mt-1 block text-xs font-normal text-suave">Sobre folha e horas extras. Informe o seu percentual.</span></label>
              <label className="text-sm font-semibold">Adicional de hora extra (%)<input type="number" min={50} max={300} step="any" inputMode="decimal" value={he} onChange={(e) => setHe(e.target.value)} aria-label="Adicional de hora extra (%)" className={`${classeCampo} mt-1`} /><span className="mt-1 block text-xs font-normal text-suave">Mínimo legal de 50%, ou o do acordo.</span></label>
              <label className="text-sm font-semibold">Custo por contratação (R$)<input type="number" min={0} step="any" inputMode="decimal" value={contratacao} onChange={(e) => setContratacao(e.target.value)} aria-label="Custo por contratação (R$)" className={`${classeCampo} mt-1`} /><span className="mt-1 block text-xs font-normal text-suave">Recrutamento e treinamento, valor único.</span></label>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm" aria-label="Custo por estratégia">
                <thead className="text-xs font-semibold uppercase tracking-wide text-suave"><tr><th className="pb-1.5 pr-3">Fase</th><th className="pb-1.5 pr-3">Como cobrir</th><th className="pb-1.5 pr-3 text-right">Contratações</th><th className="pb-1.5 pr-3 text-right">Custo por mês</th><th className="pb-1.5 pr-3 text-right">Custo no ano</th><th className="pb-1.5" /></tr></thead>
                <tbody className="divide-y divide-linha">
                  {custos.map((c) => (
                    <tr key={`${c.fase}${c.tipo}`} className={c.maisBarato ? 'bg-ok-bg/40' : ''}>
                      <td className="py-2 pr-3 font-semibold">{c.fase === 'F1' ? 'Fase 1' : 'Fase 2'}</td>
                      <td className="py-2 pr-3">{c.tipo === 'horas_extras' ? 'Horas extras' : 'Contratar'}</td>
                      <td className="py-2 pr-3 text-right">{c.tipo === 'contratar' ? inteiro(c.resultado.contratacoes) : '—'}</td>
                      <td className="py-2 pr-3 text-right">{moeda(c.resultado.custoMensalCentavos)}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{moeda(c.resultado.custoAnualCentavos)}</td>
                      <td className="py-2 text-right">{c.maisBarato ? <span className="rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-semibold text-ok-fg">menor custo</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-suave">Inclui o efeito do novo valor da hora (divisor menor) nas horas extras já praticadas. Estimativa para planejamento: não considera custo de rescisão, férias e 13º além dos encargos informados.</p>
          </>
        )}
      </Cartao>

      <div className="flex flex-wrap gap-2">
        <Link href={`${base}/escalas/adequador`} className={classeBotaoLink}>Gerar a escala 5x2</Link>
        <Link href={`${base}/diagnostico`} className={classeBotaoLink}>Diagnóstico completo e relatórios</Link>
      </div>
      <p className="text-xs text-suave">Calculado agora, com os contratos vigentes e as regras cadastradas; nada é gravado. Não substitui parecer jurídico nem contábil.</p>
    </div>
  );
}
