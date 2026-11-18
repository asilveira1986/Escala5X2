import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { textoComunicado, type DadosComunicados } from './comunicado';

const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const MARCA = '#4f46e5';
const e = StyleSheet.create({
  pagina: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 56, fontSize: 11, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.45 },
  topo: { borderBottomWidth: 1.5, borderBottomColor: MARCA, paddingBottom: 8, marginBottom: 22 },
  empresa: { fontSize: 12, fontFamily: 'Helvetica-Bold' }, cnpj: { fontSize: 9, color: '#4b5563' },
  titulo: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 14 },
  rotulo: { fontSize: 9, color: '#6b7280' }, valor: { fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  p: { marginBottom: 9, textAlign: 'justify' },
  assin: { marginTop: 44, flexDirection: 'row', justifyContent: 'space-between' },
  linha: { width: '45%', borderTopWidth: 0.8, borderTopColor: '#111827', paddingTop: 3, fontSize: 9, textAlign: 'center' },
  rodape: { position: 'absolute', bottom: 24, left: 56, right: 56, fontSize: 7.5, color: '#6b7280', textAlign: 'center' },
});

export function ComunicadosPdf({ d }: { d: DadosComunicados }) {
  return (
    <Document title={`Comunicado de adequação de jornada — ${d.empresa.razaoSocial}`} author="JornadaCerta">
      {d.itens.map((i, n) => (
        <Page key={`${n}${i.nome}`} size="A4" style={e.pagina}>
          <View style={e.topo}><Text style={e.empresa}>{d.empresa.razaoSocial}</Text><Text style={e.cnpj}>CNPJ {d.empresa.cnpj}</Text></View>
          <Text style={e.titulo}>Comunicado de adequação da jornada de trabalho</Text>
          <Text style={e.rotulo}>Colaborador(a)</Text><Text style={e.valor}>{i.nome}</Text>
          {i.setor ? <><Text style={e.rotulo}>Setor</Text><Text style={e.valor}>{i.setor}</Text></> : null}
          <View style={{ height: 8 }} />
          {textoComunicado(d, i).map((t, k) => <Text key={k} style={e.p}>{t}</Text>)}
          <View style={e.assin}>
            <Text style={e.linha}>{d.empresa.razaoSocial}{'\n'}Empresa</Text>
            <Text style={e.linha}>{i.nome}{'\n'}Ciente em ____/____/________</Text>
          </View>
          <Text style={e.rodape} fixed>Minuta gerada pelo JornadaCerta em {dataBr(d.geradoEm)}. Revise o texto com o jurídico da empresa antes de usar.</Text>
        </Page>
      ))}
    </Document>
  );
}

export async function gerarComunicadosPdf(d: DadosComunicados): Promise<Uint8Array> {
  return new Uint8Array(await renderToBuffer(<ComunicadosPdf d={d} />));
}
