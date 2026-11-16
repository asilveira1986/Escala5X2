import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { duracao, hhmm } from '@jc/rules-engine';
import { FormModeloTurno } from '../FormModeloTurno';

type ModeloLinha = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number; cor: string };

export default async function Turnos({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('turno_modelo').select('id, nome, inicio_min, fim_min, intervalo_min, cor').eq('empresa_id', empresaId).eq('ativo', true).order('inicio_min');
  const modelos = linhas<ModeloLinha>(data);
  return (
    <>
      <Cartao titulo="Turnos cadastrados" subtitulo="Modelos de horário para pintar na grade da escala.">
        {modelos.length === 0 ? <EstadoVazio titulo="Nenhum turno ainda">Cadastre o primeiro abaixo.</EstadoVazio> : (
          <ul className="flex flex-wrap gap-2">
            {modelos.map((m) => (
              <li key={m.id} className="rounded-full border border-linha bg-fundo px-3 py-1 text-sm">
                <span className="font-semibold">{m.nome}</span> {hhmm(m.inicio_min)}–{hhmm(m.fim_min)}
                <span className="text-suave"> · {duracao(m.fim_min - m.inicio_min - m.intervalo_min)} líquidas</span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
      <Cartao titulo="Novo turno"><FormModeloTurno empresaId={empresaId} /></Cartao>
    </>
  );
}
