import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconeBaixar } from '@/components/icones';
import { Cartao, classeBotaoLink } from '@/components/ui';
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/empresas/${empresaId}/diagnostico`} className="inline-flex min-h-10 items-center text-sm font-semibold text-marca hover:underline">← Diagnósticos</Link>
        <div className="flex flex-wrap gap-2">
          <a className={classeBotaoLink} href={`${base}?formato=pdf`}><IconeBaixar width={18} height={18} />Baixar PDF</a>
          <a className={classeBotaoLink} href={`${base}?formato=xlsx`}><IconeBaixar width={18} height={18} />Baixar planilha</a>
        </div>
      </div>
      <PainelDiagnostico diagnostico={d} />
      <Cartao titulo="Horas a cobrir por dia da semana" subtitulo="Estimativa para a fase 2, distribuída igualmente entre os dias."><GraficoDeficit minutosPorDia={porDia} /></Cartao>
      <Cartao titulo="E se…? Simule uma solução" subtitulo="Escolha como cobrir as horas que deixam de ser trabalhadas. O sistema nunca simula redução de salário."><Simulador diagnosticoId={diagId} empresaId={empresaId} /></Cartao>
      <Cartao titulo="Soluções lado a lado" subtitulo="O menor custo anual aparece destacado."><ComparacaoCenarios cenarios={cenarios} /></Cartao>
      <Cartao titulo="Situação de cada pessoa"><TabelaItens itens={d.itens} /></Cartao>
      <p className="text-xs text-suave">Estimativa para planejamento, calculada com as regras cadastradas e as premissas informadas. Não substitui parecer jurídico nem contábil. Nenhum cenário considera redução de salário.</p>
    </>
  );
}
