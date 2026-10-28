import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { corValida, MARCA_PADRAO, type DadosRelatorio } from './tipos';
import { data, decimal, horasMin, inteiro, moeda, moedaHora, ROTULO_CENARIO, ROTULO_CLASSIFICACAO, ROTULO_EXCECAO } from './formatar';

export const MAX_LINHAS_COLABORADORES_PDF = 500;

function estilos(cor: string) {
  return StyleSheet.create({
    pagina: { paddingTop: 56, paddingBottom: 56, paddingHorizontal: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#111827' },
    cabecalho: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: cor, paddingBottom: 8, marginBottom: 12 },
    marca: { flexDirection: 'row', alignItems: 'center' },
    logo: { height: 28, marginRight: 8, objectFit: 'contain' },
    nomeMarca: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: cor },
    titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
    sub: { color: '#4b5563', marginBottom: 10 },
    h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: cor, marginTop: 14, marginBottom: 6 },
    kpis: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
    kpi: { width: '25%', paddingRight: 6, marginBottom: 8 },
    kpiValor: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
    kpiRotulo: { color: '#4b5563', fontSize: 8 },
    linha: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#d1d5db', paddingVertical: 3 },
    linhaCab: { flexDirection: 'row', backgroundColor: cor, paddingVertical: 4 },
    cabTxt: { color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 8 },
    nota: { fontSize: 8, color: '#4b5563', marginTop: 6 },
    rodape: { position: 'absolute', bottom: 24, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#6b7280' },
    aviso: { marginTop: 12, padding: 6, borderWidth: 0.5, borderColor: '#9ca3af', fontSize: 8, color: '#374151' },
  });
}

type Coluna = { rotulo: string; largura: string; alinhar?: 'right' };

function Tabela({ colunas, linhas, e }: { colunas: Coluna[]; linhas: string[][]; e: ReturnType<typeof estilos> }) {
  return (
    <View>
      <View style={e.linhaCab} fixed>
        {colunas.map((c) => <Text key={c.rotulo} style={[e.cabTxt, { width: c.largura, paddingHorizontal: 2, textAlign: c.alinhar ?? 'left' }]}>{c.rotulo}</Text>)}
      </View>
      {linhas.map((l, i) => (
        <View key={i} style={e.linha} wrap={false}>
          {l.map((v, j) => <Text key={j} style={{ width: colunas[j]!.largura, paddingHorizontal: 2, textAlign: colunas[j]!.alinhar ?? 'left' }}>{v}</Text>)}
        </View>
      ))}
    </View>
  );
}

export function RelatorioDiagnostico({ dados }: { dados: DadosRelatorio }) {
  const cor = corValida(dados.marca.corPrimaria) ? dados.marca.corPrimaria : MARCA_PADRAO.corPrimaria;
  const e = estilos(cor);
  const { diagnostico: d, empresa, marca } = dados;
  const r = d.resumo;
  const c = r.porClassificacao;
  const kpis: Array<[string, string]> = [
    ['Colaboradores analisados', inteiro(r.total)], ['Já adequados', inteiro(c.adequado)],
    ['Adequar na fase 1', inteiro(c.adequacao_f1)], ['Adequar na fase 2', inteiro(c.adequacao_f2)],
    ['Exceções (alta renda / acordo)', inteiro(c.excecao)], ['Folha mensal', moeda(r.folhaMensalCentavos)],
    ['Déficit semanal fase 1 / fase 2', `${horasMin(r.horasPerdidasF1Min)} / ${horasMin(r.horasPerdidasF2Min)}`],
    ['Equivalente em pessoas (FTE) F1 / F2', `${decimal(r.fteF1)} / ${decimal(r.fteF2)}`],
  ];
  const afetados = d.itens.filter((i) => i.classificacao === 'adequacao_f1' || i.classificacao === 'adequacao_f2');
  const listados = afetados.slice(0, MAX_LINHAS_COLABORADORES_PDF);
  const melhor = dados.cenarios.filter((x) => !x.resultado.bloqueado).sort((a, b) => a.resultado.custoAnualCentavos - b.resultado.custoAnualCentavos)[0];

  return (
    <Document title={`Diagnóstico 5x2 — ${empresa.razaoSocial}`} author={marca.nome} creator="JornadaCerta">
      <Page size="A4" style={e.pagina}>
        <View style={e.cabecalho} fixed>
          <View style={e.marca}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {marca.logo ? <Image style={e.logo} src={{ data: Buffer.from(marca.logo), format: isPng(marca.logo) ? 'png' : 'jpg' }} /> : null}
            <Text style={e.nomeMarca}>{marca.nome}</Text>
          </View>
          <Text style={{ color: '#4b5563' }}>Gerado em {data(dados.geradoEm)}</Text>
        </View>

        <Text style={e.titulo}>Diagnóstico de adequação à escala 5x2 (EC 141/2026)</Text>
        <Text style={e.sub}>{empresa.razaoSocial} · CNPJ {empresa.cnpj} · Data de referência {data(d.dataReferencia)}</Text>
        <Text style={e.sub}>Fase 1: de {data(d.fases.f1Inicio)} a {data(d.fases.f1Fim)} (máx. 42h) · Fase 2: a partir de {data(d.fases.f2Inicio)} (máx. 40h)</Text>

        <View style={e.kpis}>
          {kpis.map(([rot, val]) => (
            <View key={rot} style={e.kpi}><Text style={e.kpiValor}>{val}</Text><Text style={e.kpiRotulo}>{rot}</Text></View>
          ))}
        </View>

        <Text style={e.h2}>Impacto por setor e turno</Text>
        <Tabela e={e}
          colunas={[{ rotulo: 'Setor', largura: '22%' }, { rotulo: 'Turno', largura: '14%' }, { rotulo: 'Colab.', largura: '9%', alinhar: 'right' }, { rotulo: 'Déficit F1', largura: '14%', alinhar: 'right' },
            { rotulo: 'Déficit F2', largura: '14%', alinhar: 'right' }, { rotulo: 'FTE F1', largura: '12%', alinhar: 'right' }, { rotulo: 'FTE F2', largura: '15%', alinhar: 'right' }]}
          linhas={[...d.grupos].sort((a, b) => b.horasPerdidasF2Min - a.horasPerdidasF2Min).map((g) => [g.setor ?? '—', g.turno ?? '—', inteiro(g.colaboradores), horasMin(g.horasPerdidasF1Min), horasMin(g.horasPerdidasF2Min), decimal(g.fteF1), decimal(g.fteF2)])} />
        <Text style={e.nota}>Déficit = horas semanais de cobertura perdidas. FTE = déficit ÷ jornada-alvo média do grupo. Distribuição por dia da semana é estimada de forma uniforme.</Text>

        {dados.cenarios.length > 0 && (
          <>
            <Text style={e.h2}>Comparação de cenários de correção</Text>
            <Tabela e={e}
              colunas={[{ rotulo: 'Cenário', largura: '30%' }, { rotulo: 'Fase', largura: '8%' }, { rotulo: 'Custo mensal', largura: '20%', alinhar: 'right' }, { rotulo: 'Custo anual', largura: '22%', alinhar: 'right' }, { rotulo: 'Contratações', largura: '20%', alinhar: 'right' }]}
              linhas={dados.cenarios.map((x) => [x.nome || ROTULO_CENARIO[x.resultado.tipo], x.resultado.fase,
                x.resultado.bloqueado ? 'Bloqueado' : moeda(x.resultado.custoMensalCentavos), x.resultado.bloqueado ? '—' : moeda(x.resultado.custoAnualCentavos), inteiro(x.resultado.contratacoes)])} />
            {melhor && <Text style={e.nota}>Menor custo anual entre os cenários: {melhor.nome || ROTULO_CENARIO[melhor.resultado.tipo]} ({moeda(melhor.resultado.custoAnualCentavos)}). O custo considera apenas as premissas informadas.</Text>}
          </>
        )}

        <Text style={e.h2} break>Colaboradores a adequar ({inteiro(afetados.length)})</Text>
        <Tabela e={e}
          colunas={[{ rotulo: 'Nome', largura: '24%' }, { rotulo: 'Setor', largura: '14%' }, { rotulo: 'Situação', largura: '16%' }, { rotulo: 'Jornada atual › F1 › F2', largura: '24%' }, { rotulo: 'Valor/hora atual › F2', largura: '22%', alinhar: 'right' }]}
          linhas={listados.map((i) => [i.nome, i.setor ?? '—', ROTULO_CLASSIFICACAO[i.classificacao],
            `${horasMin(i.horasAtuaisMin)} › ${horasMin((i.f1 ?? i.f2).horasAlvoMin)} › ${horasMin(i.f2.horasAlvoMin)}`,
            `${moedaHora(i.valorHoraAtualCentavos)} › ${moedaHora(i.f2.valorHoraCentavos)}`])} />
        {afetados.length > listados.length && <Text style={e.nota}>Exibindo {inteiro(listados.length)} de {inteiro(afetados.length)}; a lista completa está na planilha XLSX.</Text>}

        {c.excecao > 0 && (
          <Text style={e.nota}>Exceções: {d.itens.filter((i) => i.classificacao === 'excecao').map((i) => `${i.nome} (${i.excecao ? ROTULO_EXCECAO[i.excecao] : '—'})`).slice(0, 12).join('; ')}{c.excecao > 12 ? '…' : ''}.</Text>
        )}

        <View style={e.aviso}>
          <Text>Este relatório é uma estimativa para planejamento, calculada com as regras cadastradas na data de geração e nas premissas informadas. Não substitui parecer jurídico nem contábil; confirme prazos, convenções e acordos coletivos com profissional habilitado. Nenhum cenário considera redução de salário.</Text>
        </View>

        <View style={e.rodape} fixed>
          <Text>{marca.nome} · {empresa.razaoSocial}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function isPng(b: Uint8Array): boolean {
  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

export async function gerarRelatorioPdf(dados: DadosRelatorio): Promise<Uint8Array> {
  return new Uint8Array(await renderToBuffer(<RelatorioDiagnostico dados={dados} />));
}
