import Link from 'next/link';
import { PassoAPasso } from '@/components/PassoAPasso';
import { Cartao, classeBotaoLink } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { DiagnosticoResumoRow } from '@/lib/tipos-db';
import { dataDeInstante } from '@jc/rules-engine';
import { data as dataBr, inteiro } from '@jc/documents/formatar';
import { FormDiagnostico } from './FormDiagnostico';

export default async function Diagnosticos({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [{ data }, { count }] = await Promise.all([
    supabase.from('diagnostico').select('id, data_referencia, criado_em, resumo').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(20),
    supabase.from('vw_colaborador_vigente').select('colaborador_id', { count: 'exact', head: true }).eq('empresa_id', empresaId),
  ]);
  const lista = linhas<DiagnosticoResumoRow>(data);
  const { count: qtdCenarios } = lista.length > 0
    ? await supabase.from('cenario').select('id', { count: 'exact', head: true }).in('diagnostico_id', lista.map((d) => d.id))
    : { count: 0 };
  const temEquipe = (count ?? 0) > 0;
  return (
    <>
      <PassoAPasso passos={[
        { rotulo: 'Cadastre a equipe', descricao: 'Envie a planilha com os colaboradores.', feito: temEquipe, href: `/empresas/${empresaId}/importar` },
        { rotulo: 'Rode o diagnóstico', descricao: 'Veja quem precisa mudar de escala.', feito: lista.length > 0 },
        { rotulo: 'Compare soluções', descricao: 'Simule e baixe o relatório em PDF ou planilha.', feito: (qtdCenarios ?? 0) > 0, href: lista[0] ? `/empresas/${empresaId}/diagnostico/${lista[0].id}` : undefined },
      ]} />
      <Cartao titulo="Novo diagnóstico" subtitulo="Classifica cada pessoa pelas regras da EC 141/2026, calcula o novo valor da hora e as horas a cobrir. Nenhum cenário reduz salário.">
        {temEquipe ? <FormDiagnostico empresaId={empresaId} hoje={dataDeInstante(new Date())} /> : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-suave">Antes de rodar, cadastre a equipe.</p>
            <Link href={`/empresas/${empresaId}/importar`} className={classeBotaoLink}>Importar planilha</Link>
          </div>
        )}
      </Cartao>
      <Cartao titulo="Diagnósticos anteriores">
        {lista.length === 0 ? <p className="text-sm text-suave">Nenhum diagnóstico ainda.</p> : (
          <ul className="divide-y divide-linha">
            {lista.map((d) => {
              const r = d.resumo.resumo;
              const aAdequar = r ? (r.porClassificacao.adequacao_f1 ?? 0) + (r.porClassificacao.adequacao_f2 ?? 0) : null;
              return (
                <li key={d.id}>
                  <Link href={`/empresas/${empresaId}/diagnostico/${d.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2 hover:text-marca">
                    <span className="font-semibold">Referência {dataBr(d.data_referencia)}</span>
                    <span className="text-sm text-suave">{r ? `${inteiro(r.total)} pessoas · ${inteiro(aAdequar ?? 0)} a adequar · ` : ''}gerado em {dataBr(d.criado_em)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </>
  );
}
