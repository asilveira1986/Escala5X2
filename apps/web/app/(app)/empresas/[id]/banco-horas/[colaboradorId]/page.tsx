import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Cartao } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { calcularSaldo, type Lancamento } from '@jc/servicos';
import { dataDeInstante } from '@jc/rules-engine';
import { Extrato } from '../Extrato';
import { FormLancamento } from '../FormLancamento';
import { ResumoSaldo } from '../Resumo';

export default async function BancoHorasColaborador({ params }: { params: Promise<{ id: string; colaboradorId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), colabId = idOu404(p.colaboradorId);
  const { supabase } = await exigirUsuario();
  const hoje = dataDeInstante(new Date());
  const [{ data: c }, { data: lan }, { data: ger }] = await Promise.all([
    supabase.from('colaborador').select('id, nome, empresa_id').eq('id', colabId).maybeSingle(),
    supabase.from('banco_horas_lancamento').select('id, colaborador_id, data, minutos, origem, descricao, vence_em, estorna_id, criado_em').eq('colaborador_id', colabId).limit(5000),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const colab = c as { id: string; nome: string; empresa_id: string } | null;
  if (!colab || colab.empresa_id !== empresaId) notFound();
  const lancamentos = linhas<Lancamento>(lan);
  const saldo = calcularSaldo(lancamentos, hoje);
  const podeGerir = ger === true;
  return (
    <>
      <Link href={`/empresas/${empresaId}/banco-horas`} className="inline-flex min-h-9 items-center text-sm font-semibold text-marca hover:underline">← Banco de horas</Link>
      <h2 className="text-xl font-bold">{colab.nome}</h2>
      <Cartao titulo="Situação"><ResumoSaldo saldo={saldo} /></Cartao>
      {podeGerir ? <Cartao titulo="Novo lançamento" subtitulo="O livro é imutável: se errar, estorne o lançamento (fica registrado quem, quando e por quê)."><FormLancamento empresaId={empresaId} colaboradorId={colabId} hoje={hoje} vencidoMin={saldo.vencidoMin} /></Cartao> : null}
      <Cartao titulo="Extrato">{lancamentos.length === 0 ? <p className="text-sm text-suave">Nenhum lançamento.</p> : <Extrato lancamentos={lancamentos} empresaId={podeGerir ? empresaId : undefined} />}</Cartao>
    </>
  );
}
