import Link from 'next/link';
import { Cartao, classeBotaoLinkPrimario } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { agruparPorDia, rotuloFaixa, type Demanda } from '@/lib/cobertura';
import { TabelaCobertura, type LinhaCobertura } from './TabelaCobertura';

export default async function Cobertura({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [dem, set, ger] = await Promise.all([
    supabase.from('demanda_cobertura').select('id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal').eq('empresa_id', empresaId).limit(500),
    supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome'),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const nomeSetor = new Map(linhas<{ id: string; nome: string }>(set.data).map((s) => [s.id, s.nome]));
  const podeGerir = ger.data === true;
  const dados: LinhaCobertura[] = agruparPorDia(linhas<Demanda>(dem.data)).flatMap((g) => g.itens.map((d) => ({
    id: d.id, dia: g.dia.longo, faixa: rotuloFaixa(d), minimo: `${d.minimo}${d.ideal != null ? ` (ideal ${d.ideal})` : ''}`, setor: d.setor_id ? nomeSetor.get(d.setor_id) ?? 'Setor' : null,
  })));
  return (
    <Cartao icone="cobertura" titulo={`${dados.length} ${dados.length === 1 ? 'faixa' : 'faixas'}`}
      subtitulo="Quantas pessoas precisam estar trabalhando em cada faixa de horário. O editor avisa quando a grade fica abaixo do mínimo (nunca impede de publicar)."
      acoes={podeGerir ? <Link href={`/empresas/${empresaId}/escalas/cobertura/nova`} className={classeBotaoLinkPrimario}>Nova faixa</Link> : undefined}>
      <TabelaCobertura dados={dados} empresaId={empresaId} podeGerir={podeGerir} />
    </Cartao>
  );
}
