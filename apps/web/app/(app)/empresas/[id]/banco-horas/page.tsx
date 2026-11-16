import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { todasAsLinhas } from '@/lib/paginar';
import { horasTexto, saldoTexto } from '@/lib/banco-horas-ui';
import { calcularSaldo, lerEntradaDiagnostico, valorEstimadoVencido, type Lancamento } from '@jc/servicos';
import { dataDeInstante, divisorEfetivo, resolverRegras, valorHoraCentavos } from '@jc/rules-engine';

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

  const linhasTabela = colaboradores.filter((c) => porPessoa.has(c.id)).map((c) => {
    const s = calcularSaldo(porPessoa.get(c.id)!, hoje);
    const vh = valorHora.get(c.id);
    return { c, s, valor: vh && s.vencidoMin > 0 ? valorEstimadoVencido(s.vencidoMin, vh.hora, vh.adicional) : 0 };
  }).sort((a, b) => b.s.vencidoMin - a.s.vencidoMin || b.s.aVencerMin - a.s.aVencerMin || a.c.nome.localeCompare(b.c.nome, 'pt-BR'));
  const semLancamento = colaboradores.filter((c) => !porPessoa.has(c.id) && !c.desligamento);
  const totalVencido = linhasTabela.reduce((s, x) => s + x.s.vencidoMin, 0);
  const totalValor = linhasTabela.reduce((s, x) => s + x.valor, 0);
  const podeGerir = ger === true;

  return (
    <>
      <Link href={`/empresas/${empresaId}/escalas`} className="inline-flex min-h-9 items-center text-sm font-semibold text-marca hover:underline">← Escalas</Link>
      <Cartao titulo="Banco de horas" subtitulo="Saldo de cada colaborador, créditos que estão perto de vencer e horas vencidas a pagar como hora extra. Crédito só existe para quem tem acordo com banco de horas vigente.">
        {totalVencido > 0 ? <p className="mb-3 rounded-2xl bg-risco-bg px-3.5 py-2 text-sm font-semibold text-risco-fg">{horasTexto(totalVencido)} vencidas a pagar na empresa{totalValor > 0 ? ` (≈ ${moeda(totalValor)} com adicional)` : ''}.</p> : null}
        {linhasTabela.length === 0 ? <EstadoVazio titulo="Nenhum lançamento ainda">Abra um colaborador abaixo para lançar a primeira hora no banco.</EstadoVazio> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-semibold uppercase tracking-wide text-suave"><tr><th className="py-1.5 pr-3">Colaborador</th><th className="pr-3 text-right">Saldo</th><th className="pr-3 text-right">Vence em 30 dias</th><th className="pr-3 text-right">Vencido</th><th className="pr-3 text-right">A pagar (≈)</th><th /></tr></thead>
              <tbody className="divide-y divide-linha">
                {linhasTabela.map(({ c, s, valor }) => (
                  <tr key={c.id}>
                    <td className="py-1.5 pr-3 font-semibold">{c.nome}</td>
                    <td className={`pr-3 text-right font-semibold ${s.saldoMin < 0 ? 'text-risco-fg' : ''}`}>{saldoTexto(s.saldoMin)}</td>
                    <td className={`pr-3 text-right ${s.aVencerMin > 0 ? 'font-semibold text-atencao-fg' : ''}`}>{horasTexto(s.aVencerMin)}</td>
                    <td className={`pr-3 text-right ${s.vencidoMin > 0 ? 'font-semibold text-risco-fg' : ''}`}>{horasTexto(s.vencidoMin)}</td>
                    <td className="pr-3 text-right">{valor > 0 ? moeda(valor) : '—'}</td>
                    <td className="text-right"><Link href={`/empresas/${empresaId}/banco-horas/${c.id}`} aria-label={`Abrir banco de horas de ${c.nome}`} className="font-semibold text-marca hover:underline">Abrir</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
      {podeGerir && semLancamento.length > 0 ? (
        <Cartao titulo="Outros colaboradores" subtitulo="Ainda sem lançamentos no banco de horas.">
          <ul className="flex flex-wrap gap-2">
            {semLancamento.map((c) => <li key={c.id}><Link href={`/empresas/${empresaId}/banco-horas/${c.id}`} className="inline-flex min-h-9 items-center rounded-full border border-linha bg-cartao px-3 text-sm font-semibold hover:bg-marca-suave">{c.nome}</Link></li>)}
          </ul>
        </Cartao>
      ) : null}
    </>
  );
}
