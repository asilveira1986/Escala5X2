import Link from 'next/link';
import { Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { DiagnosticoResumoRow } from '@/lib/tipos-db';
import { dataDeInstante } from '@jc/rules-engine';
import { data as dataBr, inteiro } from '@jc/documents/formatar';
import { FormDiagnostico } from './FormDiagnostico';

export default async function Diagnosticos({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('diagnostico').select('id, data_referencia, criado_em, resumo').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(20);
  const lista = linhas<DiagnosticoResumoRow>(data);
  return (
    <>
      <Cartao titulo="Novo diagnóstico">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Classifica cada colaborador pelas regras vigentes (EC 141/2026), calcula o novo valor da hora e o déficit de cobertura. Nenhum cenário reduz salário.</p>
        <FormDiagnostico empresaId={empresaId} hoje={dataDeInstante(new Date())} />
      </Cartao>
      <Cartao titulo="Diagnósticos anteriores">
        {lista.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-400">Nenhum diagnóstico ainda.</p> : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {lista.map((d) => {
              const r = d.resumo.resumo;
              return (
                <li key={d.id} className="py-2">
                  <Link className="font-medium text-blue-800 hover:underline dark:text-blue-300" href={`/empresas/${empresaId}/diagnostico/${d.id}`}>Referência {dataBr(d.data_referencia)}</Link>
                  {r ? <span className="ml-2 text-slate-600 dark:text-slate-400">{inteiro(r.total)} colaboradores · {inteiro((r.porClassificacao.adequacao_f1 ?? 0) + (r.porClassificacao.adequacao_f2 ?? 0))} a adequar</span> : null}
                  <span className="ml-2 text-xs text-slate-500">gerado em {dataBr(d.criado_em)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </>
  );
}
