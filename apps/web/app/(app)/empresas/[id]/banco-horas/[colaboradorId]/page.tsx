import { notFound } from 'next/navigation';
import { lerAba } from '@/lib/abas';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { calcularSaldo, type Lancamento } from '@jc/servicos';
import { dataDeInstante } from '@jc/rules-engine';
import { abasBanco, TelaBancoHoras } from './TelaBancoHoras';

export default async function BancoHorasColaborador({ params, searchParams }: { params: Promise<{ id: string; colaboradorId: string }>; searchParams: Promise<{ aba?: string }> }) {
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
  const podeGerir = ger === true;
  const aba = lerAba((await searchParams).aba, abasBanco(podeGerir, 0));
  return <TelaBancoHoras empresaId={empresaId} colaborador={{ id: colab.id, nome: colab.nome }} saldo={calcularSaldo(lancamentos, hoje)} lancamentos={lancamentos} aba={aba} podeGerir={podeGerir} hoje={hoje} />;
}
