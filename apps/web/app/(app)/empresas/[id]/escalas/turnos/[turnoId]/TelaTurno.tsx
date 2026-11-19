import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { RemoverItem } from '@/components/RemoverItem';
import { Cartao } from '@/components/ui';
import { duracao, hhmm } from '@jc/rules-engine';
import { arquivarModelo } from '../../actions';
import { FormEditarTurno, type TurnoEdicao } from './FormEditarTurno';

/** Tela do turno: cabeçalho, resumo, edição e remoção. */
export function TelaTurno({ empresaId, turno: t }: { empresaId: string; turno: TurnoEdicao }) {
  const horario = `${hhmm(t.inicio_min)}–${hhmm(t.fim_min)}`;
  return (
    <>
      <CabecalhoItem icone="turnos" titulo={t.nome} subtitulo={`Turno de ${horario}`} />
      <ResumoItem rotulo="Resumo do turno" itens={[
        { rotulo: 'Entrada', valor: <span className="horario">{hhmm(t.inicio_min)}</span> },
        { rotulo: 'Saída', valor: <span className="horario">{hhmm(t.fim_min)}</span> },
        { rotulo: 'Intervalo', valor: <span className="horario">{t.intervalo_min} min</span> },
        { rotulo: 'Jornada líquida', valor: <span className="horario">{duracao(t.fim_min - t.inicio_min - t.intervalo_min)}</span> },
      ]} />
      <Cartao icone="turnos" titulo="Editar turno"><FormEditarTurno empresaId={empresaId} turno={t} /></Cartao>
      <Cartao titulo="Remover turno">
        <RemoverItem acao={arquivarModelo.bind(null, empresaId, t.id)}
          depoisPara={`/empresas/${empresaId}/escalas/turnos`} rotulo="Remover turno" aviso="O turno sai da lista. As escalas que já o usaram não mudam."
          confirmacao={`Remover o turno ${t.nome}?`} />
      </Cartao>
    </>
  );
}
