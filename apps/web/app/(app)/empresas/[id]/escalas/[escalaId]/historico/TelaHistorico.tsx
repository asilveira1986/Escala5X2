import Link from 'next/link';
import { Abas } from '@/components/Abas';
import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { Cartao, classeBotaoLink } from '@/components/ui';
import type { ResultadoDiff } from '@/lib/escala-diff';
import { TabelaMudancas, type LinhaMudanca } from './TabelaMudancas';
import { TabelaVersoes, type LinhaVersao } from './TabelaVersoes';

export const ABAS_HISTORICO = [{ id: 'versoes', rotulo: 'Versões' }, { id: 'mudancas', rotulo: 'O que mudou' }];

type Props = {
  empresaId: string; escalaId: string; nome: string; periodo: string; aba: string; versoes: LinhaVersao[]; deRotulo: string | null; paraRotulo: string;
  diff: Pick<ResultadoDiff, 'pessoas' | 'dias' | 'entraramEmTrabalho' | 'sairamDeTrabalho' | 'horarioMudou'> & { total: number } | null; mudancas: LinhaMudanca[]; base: string | undefined;
};

/** Histórico da escala: cabeçalho, resumo da comparação sempre à vista e abas (versões, o que mudou). */
export function TelaHistorico({ empresaId, escalaId, nome, periodo, aba, versoes, deRotulo, paraRotulo, diff, mudancas, base }: Props) {
  const ocultas = diff ? Math.max(0, diff.total - mudancas.length) : 0;
  return (
    <>
      <CabecalhoItem icone="calendario" titulo={`Histórico de ${nome}`} subtitulo={`${periodo} · uma publicação nova nunca apaga a anterior: ela fica guardada como substituída.`}
        selo={<Link href={`/empresas/${empresaId}/escalas/${escalaId}`} className={classeBotaoLink}>Voltar à escala</Link>} />
      <ResumoItem rotulo="Resumo do histórico" itens={diff ? [
        { rotulo: 'Versões', valor: <span className="horario">{versoes.length}</span> },
        { rotulo: 'Pessoas afetadas', valor: <span className="horario">{diff.pessoas}</span> },
        { rotulo: 'Dias alterados', valor: <span className="horario">{diff.dias}</span> },
        { rotulo: 'Passaram a trabalhar / folgar', valor: <span className="horario">+{diff.entraramEmTrabalho} / −{diff.sairamDeTrabalho}</span> },
      ] : [
        { rotulo: 'Versões', valor: <span className="horario">{versoes.length}</span> },
        { rotulo: 'Esta versão', valor: paraRotulo },
      ]} />
      <Abas abas={ABAS_HISTORICO.map((a) => (a.id === 'mudancas' && diff ? { ...a, contagem: diff.total } : a))} atual={aba} base={`/empresas/${empresaId}/escalas/${escalaId}/historico`} extras={{ de: base }} rotulo="Seções do histórico" />

      {aba === 'versoes' ? (
        <Cartao icone="calendario" titulo={`${versoes.length} ${versoes.length === 1 ? 'versão' : 'versões'}`} subtitulo="Clique numa versão para abrir, ou em Comparar para ver o que mudou em relação a esta.">
          <TabelaVersoes dados={versoes} />
        </Cartao>
      ) : (
        <Cartao icone="diagnostico" titulo="O que mudou" subtitulo={deRotulo ? `${deRotulo} → ${paraRotulo}. Escolha outra base na aba Versões, em Comparar.` : undefined}>
          {!diff ? <p className="text-sm text-suave">Esta é a primeira versão. Quando houver outra, as diferenças aparecem aqui.</p>
            : diff.total === 0 ? <p className="text-sm text-ok-fg">As duas versões são idênticas.</p> : (
              <>
                {diff.horarioMudou > 0 ? <p className="mb-2 text-sm text-suave">{diff.horarioMudou} {diff.horarioMudou === 1 ? 'dia com horário diferente' : 'dias com horário diferente'}.</p> : null}
                <TabelaMudancas dados={mudancas} />
                {ocultas > 0 ? <p className="mt-2 text-xs text-suave">Mostrando as primeiras {mudancas.length} de {diff.total} mudanças.</p> : null}
              </>
            )}
        </Cartao>
      )}
    </>
  );
}
