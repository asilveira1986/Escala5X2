import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { IconeBaixar } from '@/components/icones';
import { Selo, classeBotaoLink } from '@/components/ui';
import type { Diagnostico } from '@jc/rules-engine';
import { data, horasMin, inteiro, moeda } from '@jc/documents/formatar';
import { situacaoDiagnostico } from '@/lib/diagnostico-ui';

/** Cabeçalho do diagnóstico (referência, geração, situação e downloads) e resumo com os números principais, sempre à vista. */
export function CabecalhoDiagnostico({ diagnostico: d, criadoEm, baixarEm }: { diagnostico: Diagnostico; criadoEm: string; baixarEm: string }) {
  const r = d.resumo, c = r.porClassificacao;
  const aAdequar = (c.adequacao_f1 ?? 0) + (c.adequacao_f2 ?? 0);
  const sit = situacaoDiagnostico(aAdequar);
  return (
    <>
      <CabecalhoItem icone="diagnostico" titulo={`Diagnóstico de ${data(d.dataReferencia)}`} subtitulo={`Gerado em ${data(criadoEm)} · ${inteiro(r.total)} pessoas analisadas`}
        selo={(
          <div className="flex flex-wrap items-center gap-2">
            <Selo tom={sit.tom}>{sit.rotulo}</Selo>
            <a className={classeBotaoLink} href={`${baixarEm}?formato=pdf`}><IconeBaixar width={18} height={18} />Baixar PDF</a>
            <a className={classeBotaoLink} href={`${baixarEm}?formato=xlsx`}><IconeBaixar width={18} height={18} />Baixar planilha</a>
          </div>
        )} />
      <ResumoItem rotulo="Resumo do diagnóstico" itens={[
        { rotulo: 'Pessoas', valor: <span className="horario">{inteiro(r.total)}</span> },
        { rotulo: 'A adequar', valor: <span className="horario">{inteiro(aAdequar)}</span> },
        { rotulo: 'Horas a cobrir (fase 2)', valor: <span className="horario">{horasMin(r.horasPerdidasF2Min)}</span> },
        { rotulo: 'Folha mensal', valor: <span className="horario">{moeda(r.folhaMensalCentavos)}</span> },
      ]} />
    </>
  );
}
