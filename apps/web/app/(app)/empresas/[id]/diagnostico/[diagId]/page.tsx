import { notFound } from 'next/navigation';
import { Cartao } from '@/components/ui';
import { ComparacaoCenarios } from '@/components/ComparacaoCenarios';
import { GraficoDeficit } from '@/components/GraficoDeficit';
import { PainelDiagnostico } from '@/components/PainelDiagnostico';
import { TabelaItens } from '@/components/TabelaItens';
import { exigirUsuario, idOu404 } from '@/lib/contexto';
import { carregarDiagnostico, ErroServico } from '@jc/servicos';
import { Simulador } from './Simulador';

export default async function DetalheDiagnostico({ params }: { params: Promise<{ id: string; diagId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id);
  const diagId = idOu404(p.diagId);
  const { supabase } = await exigirUsuario();
  const salvo = await carregarDiagnostico(supabase, diagId).catch((e) => { if (e instanceof ErroServico) notFound(); throw e; });
  if (salvo.empresaId !== empresaId) notFound();

  const d = salvo.diagnostico;
  const porDia = Array<number>(7).fill(0);
  for (const g of d.grupos) g.deficitPorDiaSemanaF2Min.forEach((m, i) => { porDia[i] = (porDia[i] ?? 0) + m; });
  const base = `/api/v1/diagnosticos/${diagId}/relatorio`;
  const cenarios = salvo.cenarios.filter((c) => c.resultado).map((c) => ({ id: c.id, nome: c.nome, resultado: c.resultado! }));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Resultado do diagnóstico</h2>
        <div className="flex gap-2 text-sm">
          <a className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" href={`${base}?formato=pdf`}>Baixar PDF</a>
          <a className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" href={`${base}?formato=xlsx`}>Baixar XLSX</a>
        </div>
      </div>
      <PainelDiagnostico diagnostico={d} />
      <Cartao titulo="Déficit de cobertura por dia da semana (fase 2)"><GraficoDeficit minutosPorDia={porDia} /></Cartao>
      <Cartao titulo="Simulador de cenários"><Simulador diagnosticoId={diagId} empresaId={empresaId} /></Cartao>
      <Cartao titulo="Comparação de cenários"><ComparacaoCenarios cenarios={cenarios} /></Cartao>
      <Cartao titulo="Colaboradores"><TabelaItens itens={d.itens} /></Cartao>
      <p className="text-xs text-slate-600 dark:text-slate-400">Estimativa para planejamento, calculada com as regras cadastradas e as premissas informadas. Não substitui parecer jurídico nem contábil. Nenhum cenário considera redução de salário.</p>
    </>
  );
}
