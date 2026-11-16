import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { calcularSaldo, type Lancamento } from '@jc/servicos';
import { dataDeInstante } from '@jc/rules-engine';
import { Extrato } from '../../empresas/[id]/banco-horas/Extrato';
import { ResumoSaldo } from '../../empresas/[id]/banco-horas/Resumo';

export default async function MeuBancoDeHoras() {
  const { supabase, user } = await exigirUsuario();
  const { data: colabs } = await supabase.from('colaborador').select('id').eq('usuario_id', user.id);
  const ids = linhas<{ id: string }>(colabs).map((c) => c.id);
  if (ids.length === 0) return <EstadoVazio titulo="Seu cadastro ainda não está ligado a um colaborador">Peça ao RH para vincular o seu acesso.</EstadoVazio>;
  // O RLS deixa a gestão ver a empresa toda; aqui só entram os lançamentos da própria pessoa.
  const { data } = await supabase.from('banco_horas_lancamento').select('id, colaborador_id, data, minutos, origem, descricao, vence_em, estorna_id, criado_em').in('colaborador_id', ids).limit(5000);
  const lancamentos = linhas<Lancamento>(data);
  const saldo = calcularSaldo(lancamentos, dataDeInstante(new Date()));
  return (
    <>
      <div>
        <Link href="/minha-escala" className="inline-flex min-h-9 items-center text-sm font-semibold text-marca hover:underline">← Minha escala</Link>
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">Meu banco de horas</h1>
        <p className="mt-1 text-suave">Horas a seu favor e quando elas vencem. Crédito vencido e não compensado é pago como hora extra.</p>
      </div>
      <Cartao titulo="Situação"><ResumoSaldo saldo={saldo} /></Cartao>
      <Cartao titulo="Extrato">{lancamentos.length === 0 ? <EstadoVazio titulo="Nada lançado ainda">Quando houver horas no seu banco, elas aparecem aqui.</EstadoVazio> : <Extrato lancamentos={lancamentos} />}</Cartao>
    </>
  );
}
