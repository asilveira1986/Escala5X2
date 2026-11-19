import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { RemoverItem } from '@/components/RemoverItem';
import { Cartao, Selo } from '@/components/ui';
import { DIAS_SEMANA, rotuloFaixa, type Demanda } from '@/lib/cobertura';
import { removerDemanda } from '../actions';

/** Tela de uma faixa de cobertura: cabeçalho, resumo e remoção. */
export function TelaFaixa({ empresaId, demanda: d, setor, podeGerir }: { empresaId: string; demanda: Demanda; setor: string | null; podeGerir: boolean }) {
  const dia = DIAS_SEMANA.find((x) => x.n === d.dia_semana)?.longo ?? '—';
  return (
    <>
      <CabecalhoItem icone="cobertura" titulo={`${dia} · ${rotuloFaixa(d)}`} subtitulo={setor ? `Vale só para escalas do setor ${setor}` : 'Vale para a empresa toda'}
        selo={<Selo tom={setor ? 'azul' : 'cinza'}>{setor ?? 'Empresa toda'}</Selo>} />
      <ResumoItem rotulo="Resumo da faixa" itens={[
        { rotulo: 'Dia', valor: dia },
        { rotulo: 'Faixa', valor: <span className="horario">{rotuloFaixa(d)}</span> },
        { rotulo: 'Mínimo de pessoas', valor: <span className="horario">{d.minimo}</span> },
        { rotulo: 'Ideal', valor: <span className="horario">{d.ideal ?? '—'}</span> },
      ]} />
      {podeGerir ? (
        <Cartao titulo="Remover faixa">
          <RemoverItem acao={removerDemanda.bind(null, empresaId, d.id)} depoisPara={`/empresas/${empresaId}/escalas/cobertura`} rotulo="Remover faixa"
            aviso="Sem esta faixa, o editor deixa de conferir a quantidade de pessoas nesse horário." confirmacao={`Remover a faixa de ${dia}, ${rotuloFaixa(d)}?`} />
        </Cartao>
      ) : null}
    </>
  );
}
