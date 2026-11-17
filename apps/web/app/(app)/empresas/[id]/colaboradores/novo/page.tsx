import Link from 'next/link';
import { Cartao, Titulo } from '@/components/ui';
import { idOu404 } from '@/lib/contexto';
import { FormNovoColaborador } from './FormNovoColaborador';

export default async function NovoColaborador({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  return (
    <>
      <Titulo icone="mais" descricao="Preencha os dados da pessoa e do contrato. Para cadastrar muita gente de uma vez, use a importação por planilha.">Novo colaborador</Titulo>
      <Cartao><FormNovoColaborador empresaId={empresaId} /></Cartao>
      <p className="text-sm"><Link className="text-marca hover:underline" href={`/empresas/${empresaId}/importar`}>Prefiro importar uma planilha</Link></p>
    </>
  );
}
