import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { COR_AFASTAMENTO, COR_FERIAS, COR_FOLGA, corDaCelula, horasTexto, ROTULO_STATUS_ESCALA, SEMANA_CURTA, tituloEscala, type DadosEscalaDoc } from './escala';

const dataBr = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
const MARCA = '#4f46e5';
const e = StyleSheet.create({
  pagina: { paddingTop: 34, paddingBottom: 40, paddingHorizontal: 28, fontSize: 7, fontFamily: 'Helvetica', color: '#111827' },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1.5, borderBottomColor: MARCA, paddingBottom: 5, marginBottom: 7 },
  titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold' }, sub: { fontSize: 8, color: '#4b5563', marginTop: 1 }, marca: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: MARCA },
  selo: { fontSize: 7, fontFamily: 'Helvetica-Bold', paddingHorizontal: 5, paddingVertical: 2, borderWidth: 0.7, borderColor: '#6b7280', borderRadius: 3, alignSelf: 'flex-end', marginBottom: 2 },
  linhaCab: { flexDirection: 'row', backgroundColor: MARCA, color: '#ffffff' },
  linha: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: '#d1d5db', minHeight: 13, alignItems: 'stretch' },
  nome: { width: 112, paddingHorizontal: 3, paddingVertical: 2.5, fontFamily: 'Helvetica-Bold' },
  total: { width: 26, textAlign: 'center', paddingVertical: 2.5 },
  rodape: { position: 'absolute', bottom: 16, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#6b7280' },
  legenda: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  item: { flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 3 },
  caixa: { minWidth: 12, paddingHorizontal: 2, height: 10, marginRight: 3, textAlign: 'center', fontFamily: 'Helvetica-Bold', paddingTop: 1 },
});

export function EscalaPdf({ d }: { d: DadosEscalaDoc }) {
  const larg = `${(100 / d.dias.length).toFixed(3)}%`;
  const celula = (txt: string, fundo: string | null, extra: object = {}) => ({ width: larg, textAlign: 'center' as const, paddingVertical: 2.5, backgroundColor: fundo ?? undefined, ...extra });
  return (
    <Document title={`Escala — ${tituloEscala(d)}`} author="JornadaCerta">
      <Page size="A4" orientation="landscape" style={e.pagina}>
        <View style={e.topo} fixed>
          <View>
            <Text style={e.titulo}>{tituloEscala(d)} — {dataBr(d.periodo.inicio)} a {dataBr(d.periodo.fim)}</Text>
            <Text style={e.sub}>{d.empresa.razaoSocial} · CNPJ {d.empresa.cnpj}</Text>
          </View>
          <View><Text style={e.selo}>{ROTULO_STATUS_ESCALA[d.status]} · versão {d.versao}</Text><Text style={e.marca}>JornadaCerta</Text></View>
        </View>

        <View>
          <View style={e.linhaCab} fixed>
            <Text style={[e.nome, { color: '#ffffff' }]}>Colaborador</Text>
            <View style={{ flex: 1, flexDirection: 'row' }}>
              {d.dias.map((x) => (
                <View key={x.data} style={{ width: larg, alignItems: 'center', paddingVertical: 1.5, backgroundColor: x.feriado ? '#b91c1c' : undefined }}>
                  <Text style={{ fontFamily: 'Helvetica-Bold' }}>{Number(x.data.slice(8))}</Text><Text style={{ fontSize: 5.5 }}>{SEMANA_CURTA[x.diaSemana]}</Text>
                </View>
              ))}
            </View>
            <Text style={[e.total, { color: '#ffffff' }]}>Dias</Text><Text style={[e.total, { color: '#ffffff', width: 32 }]}>Horas</Text>
          </View>
          {d.linhas.map((l) => (
            <View key={l.nome + l.diasTrabalhados} style={e.linha} wrap={false}>
              <Text style={e.nome}>{l.nome}</Text>
              <View style={{ flex: 1, flexDirection: 'row' }}>
                {l.celulas.map((c, i) => <Text key={i} style={celula(c.texto, corDaCelula(c), { fontFamily: c.tipo === 'trabalho' ? 'Helvetica-Bold' : 'Helvetica', color: c.tipo === 'folga' ? '#6b7280' : '#111827', borderLeftWidth: d.dias[i]!.diaSemana === 1 ? 0.6 : 0, borderLeftColor: '#9ca3af' })}>{c.texto}</Text>)}
              </View>
              <Text style={e.total}>{l.diasTrabalhados}</Text><Text style={[e.total, { width: 32 }]}>{horasTexto(l.horasMin)}</Text>
            </View>
          ))}
          <View style={[e.linha, { borderTopWidth: 0.8, borderTopColor: '#6b7280', backgroundColor: '#f9fafb' }]} wrap={false}>
            <Text style={e.nome}>Pessoas trabalhando</Text>
            <View style={{ flex: 1, flexDirection: 'row' }}>{d.cobertura.map((n, i) => <Text key={i} style={celula(String(n), null, { fontFamily: 'Helvetica-Bold' })}>{n}</Text>)}</View>
            <Text style={e.total} /><Text style={[e.total, { width: 32 }]} />
          </View>
        </View>

        <View style={e.legenda} wrap={false}>
          {d.legenda.map((l) => <View key={l.codigo} style={e.item}><Text style={[e.caixa, { backgroundColor: corDaCelula({ texto: l.codigo, tipo: 'trabalho', indiceTurno: l.indiceTurno }) ?? '#fff' }]}>{l.codigo}</Text><Text>{l.descricao}</Text></View>)}
          <View style={e.item}><Text style={[e.caixa, { backgroundColor: COR_FOLGA }]}>F</Text><Text>Folga</Text></View>
          <View style={e.item}><Text style={[e.caixa, { backgroundColor: COR_FERIAS }]}>FÉR</Text><Text>Férias</Text></View>
          <View style={e.item}><Text style={[e.caixa, { backgroundColor: COR_AFASTAMENTO }]}>AFA</Text><Text>Afastamento</Text></View>
          <View style={e.item}><Text style={[e.caixa, { backgroundColor: '#b91c1c', color: '#ffffff' }]}>17</Text><Text>Feriado</Text></View>
        </View>

        <View style={e.rodape} fixed>
          <Text>{d.hash ? `Código de integridade: ${d.hash.slice(0, 24)}…` : 'Escala ainda não publicada: sujeita a alterações.'} · Gerada em {dataBr(d.geradoEm)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function gerarEscalaPdf(d: DadosEscalaDoc): Promise<Uint8Array> {
  return new Uint8Array(await renderToBuffer(<EscalaPdf d={d} />));
}
