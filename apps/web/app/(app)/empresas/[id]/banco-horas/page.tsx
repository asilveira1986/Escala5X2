import { Aviso, Cartao } from '@/components/ui';
import { exigirUsuario, idOu404 } from '@/lib/contexto';
import { todasAsLinhas } from '@/lib/paginar';
import { horasTexto, situacaoBanco } from '@/lib/banco-horas-ui';
import { calcularSaldo, lerEntradaDiagnostico, valorEstimadoVencido, type Lancamento } from '@jc/servicos';
import { dataDeInstante, divisorEfetivo, resolverRegras, valorHoraCentavos } from '@jc/rules-engine';
import { TabelaBancoHoras, type LinhaBanco } from './TabelaBancoHoras';

const moeda = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default async function BancoHoras({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const hoje = dataDeInstante(new Date());
  const [col, lan, { data: ger }, { data: entradaBruta }] = await Promise.all([
    // o Supabase corta cada consulta em 1000 linhas: lê por páginas
    todasAsLinhas<{ id: string; nome: string; desligamento: string | null }>((a, b) => supabase.from('colaborador').select('id, nome, desligamento').eq('empresa_id', empresaId).order('nome').range(a, b)),
    todasAsLinhas<Lancamento>((a, b) => supabase.from('banco_horas_lancamento').select('id, colaborador_id, data, minutos, origem, descricao, vence_em, estorna_id, criado_em').eq('empresa_id', empresaId).order('id').range(a, b), { maximo: 500_000 }),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
    supabase.rpc('diagnostico_entrada', { p_empresa: empresaId, p_data: hoje }),
  ]);
  const colaboradores = col.linhas;
  const porPessoa = new Map<string, Lancamento[]>();
  for (const l of lan.linhas) porPessoa.set(l.colaborador_id, [...(porPessoa.get(l.colaborador_id) ?? []), l]);

  // Valor estimado do que pagar pelo crédito vencido (hora × adicional de hora extra); só para quem tem contrato vigente.
  const valorHora = new Map<string, { hora: number; adicional: number }>();
  try {
    const e = lerEntradaDiagnostico(entradaBruta);
    for (const c of e.colaboradores) {
      const r = resolverRegras(c, hoje, e.regras);
      valorHora.set(c.colaboradorId, { hora: valorHoraCentavos(c.salarioBaseCentavos, divisorEfetivo(r, c)), adicional: r.adicionalHePercentual });
    }
  } catch { /* sem contratos: sem estimativa */ }

  const podeGerir = ger === true;
  // quem já tem lançamentos aparece sempre; quem ainda não tem só para a gestão (para poder lançar a primeira hora)
  const linhasTabela: Array<LinhaBanco & { vencidoMin: number; aVencerMin: number }> = colaboradores
    .filter((c) => porPessoa.has(c.id) || (podeGerir && !c.desligamento))
    .map((c) => {
      const lanc = porPessoa.get(c.id);
      if (!lanc) return { id: c.id, nome: c.nome, saldoMin: null, situacao: situacaoBanco(null), valorCentavos: 0, vencidoMin: 0, aVencerMin: 0 };
      const s = calcularSaldo(lanc, hoje);
      const vh = valorHora.get(c.id);
      return { id: c.id, nome: c.nome, saldoMin: s.saldoMin, situacao: situacaoBanco(s), valorCentavos: vh && s.vencidoMin > 0 ? valorEstimadoVencido(s.vencidoMin, vh.hora, vh.adicional) : 0, vencidoMin: s.vencidoMin, aVencerMin: s.aVencerMin };
    })
    .sort((a, b) => b.vencidoMin - a.vencidoMin || b.aVencerMin - a.aVencerMin || a.nome.localeCompare(b.nome, 'pt-BR'));
  const totalVencido = linhasTabela.reduce((s, x) => s + x.vencidoMin, 0);
  const totalValor = linhasTabela.reduce((s, x) => s + x.valorCentavos, 0);
  const dados: LinhaBanco[] = linhasTabela.map(({ vencidoMin: _v, aVencerMin: _a, ...l }) => l);

  return (
    <Cartao icone="banco" titulo={`${dados.length} ${dados.length === 1 ? 'pessoa' : 'pessoas'}`}
      subtitulo="Saldo de cada colaborador, créditos perto de vencer e horas vencidas a pagar como hora extra. Crédito só existe para quem tem acordo com banco de horas vigente.">
      {totalVencido > 0 ? <div className="mb-3"><Aviso tipo="erro">{horasTexto(totalVencido)} vencidas a pagar na empresa{totalValor > 0 ? ` (≈ ${moeda(totalValor)} com adicional)` : ''}.</Aviso></div> : null}
      <TabelaBancoHoras dados={dados} empresaId={empresaId} />
    </Cartao>
  );
}
