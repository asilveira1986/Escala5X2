import Link from 'next/link';
import { Cartao, classeBotaoLink, Titulo } from '@/components/ui';
import { exigirUsuario, idOu404 } from '@/lib/contexto';
import { dataDeInstante } from '@jc/rules-engine';
import { FormDiagnostico } from '../FormDiagnostico';

export default async function NovoDiagnostico({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { count } = await supabase.from('vw_colaborador_vigente').select('colaborador_id', { count: 'exact', head: true }).eq('empresa_id', empresaId);
  return (
    <>
      <Titulo icone="mais" descricao="Classifica cada pessoa pelas regras da EC 141/2026, calcula o novo valor da hora e as horas a cobrir. Nenhum cenário reduz salário.">Novo diagnóstico</Titulo>
      <Cartao>
        {(count ?? 0) > 0 ? <FormDiagnostico empresaId={empresaId} hoje={dataDeInstante(new Date())} /> : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-suave">Antes de rodar, cadastre a equipe.</p>
            <Link href={`/empresas/${empresaId}/importar`} className={classeBotaoLink}>Importar planilha</Link>
          </div>
        )}
      </Cartao>
    </>
  );
}
