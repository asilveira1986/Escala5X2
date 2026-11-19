import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { RemoverItem } from '@/components/RemoverItem';
import { Cartao, Selo } from '@/components/ui';
import { diasDaAusencia, ROTULO_SITUACAO, TOM_SITUACAO, type SituacaoAusencia } from '@/lib/ausencias';
import type { DataISO } from '@jc/rules-engine';
import { dataBr } from '@jc/rules-engine';
import { removerAusencia } from '../actions';

const iniciais = (nome: string) => { const p = nome.trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?'; };

export type AusenciaTela = { id: string; pessoa: string; tipo: 'ferias' | 'afastamento'; inicio: DataISO; fim: DataISO; observacao: string | null; situacao: SituacaoAusencia };

/** Tela de uma ausência: cabeçalho, resumo, observação e remoção. */
export function TelaAusencia({ empresaId, ausencia: a, podeGerir }: { empresaId: string; ausencia: AusenciaTela; podeGerir: boolean }) {
  const tipo = a.tipo === 'ferias' ? 'Férias' : 'Afastamento';
  const dias = diasDaAusencia(a.inicio, a.fim);
  return (
    <>
      <CabecalhoItem iniciais={iniciais(a.pessoa)} titulo={a.pessoa} subtitulo={`${tipo} · ${dataBr(a.inicio)} a ${dataBr(a.fim)}`}
        selo={<Selo tom={TOM_SITUACAO[a.situacao]}>{ROTULO_SITUACAO[a.situacao]}</Selo>} />
      <ResumoItem rotulo="Resumo da ausência" itens={[
        { rotulo: 'Tipo', valor: tipo },
        { rotulo: 'Primeiro dia', valor: <span className="horario">{dataBr(a.inicio)}</span> },
        { rotulo: 'Último dia', valor: <span className="horario">{dataBr(a.fim)}</span> },
        { rotulo: 'Duração', valor: <span className="horario">{dias} {dias === 1 ? 'dia' : 'dias'}</span> },
      ]} />
      {a.observacao ? <Cartao titulo="Observação"><p className="text-sm">{a.observacao}</p></Cartao> : null}
      {podeGerir ? (
        <Cartao titulo="Remover lançamento">
          <RemoverItem acao={removerAusencia.bind(null, empresaId, a.id)} depoisPara={`/empresas/${empresaId}/escalas/ausencias`} rotulo="Remover lançamento"
            aviso="Sem este lançamento, a pessoa volta a poder ser escalada nesses dias." confirmacao={`Remover o lançamento de ${a.pessoa} (${dataBr(a.inicio)} a ${dataBr(a.fim)})?`} />
        </Cartao>
      ) : null}
    </>
  );
}
