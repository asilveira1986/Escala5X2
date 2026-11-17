import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { FormModeloTurno } from '../FormModeloTurno';
import { ListaTurnos } from './ListaTurnos';

type ModeloLinha = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number };

export default async function Turnos({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('turno_modelo').select('id, nome, inicio_min, fim_min, intervalo_min').eq('empresa_id', empresaId).eq('ativo', true).order('inicio_min');
  const modelos = linhas<ModeloLinha>(data);
  return (
    <>
      <Cartao icone="turnos" titulo="Turnos cadastrados" subtitulo="Modelos de horário para pintar na grade da escala. Dá para editar ou remover.">
        {modelos.length === 0 ? <EstadoVazio titulo="Nenhum turno ainda">Cadastre o primeiro abaixo.</EstadoVazio> : <ListaTurnos empresaId={empresaId} turnos={modelos} />}
      </Cartao>
      <Cartao icone="mais" titulo="Novo turno"><FormModeloTurno empresaId={empresaId} /></Cartao>
    </>
  );
}
