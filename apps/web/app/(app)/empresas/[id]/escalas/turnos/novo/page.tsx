import { Cartao, Titulo } from '@/components/ui';
import { idOu404 } from '@/lib/contexto';
import { FormModeloTurno } from '../../FormModeloTurno';

export default async function NovoTurno({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  return (
    <>
      <Titulo icone="mais" descricao="Um modelo de horário para pintar na grade das escalas.">Novo turno</Titulo>
      <Cartao><FormModeloTurno empresaId={empresaId} /></Cartao>
    </>
  );
}
