import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui';
import { lerAba } from '@/lib/abas';
import { minutosParaHoras, reaisParaTexto } from '@/lib/colaborador-form';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { dataDeInstante } from '@jc/rules-engine';
import type { Acesso } from '../CelulaAcesso';
import { ABAS, inicioDe, TelaColaborador, type Contrato } from './TelaColaborador';

type Colab = { id: string; nome: string; matricula: string | null; cargo: string | null; cbo: string | null; escolaridade: string | null; admissao: string; desligamento: string | null; usuario_id: string | null; setor: { nome: string } | null };

export default async function EditarColaborador({ params, searchParams }: { params: Promise<{ id: string; colaboradorId: string }>; searchParams: Promise<{ aba?: string }> }) {
  const p = await params;
  const aba = lerAba((await searchParams).aba, ABAS);
  const empresaId = idOu404(p.id), colaboradorId = idOu404(p.colaboradorId);
  const { supabase } = await exigirUsuario();
  const [{ data: c }, { data: ct }, { data: pode }, { data: pii }] = await Promise.all([
    supabase.from('colaborador').select('id, nome, matricula, cargo, cbo, escolaridade, admissao, desligamento, usuario_id, setor:setor_id(nome)').eq('id', colaboradorId).eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('contrato_versao').select('id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala, folgas_semana, turno, horas_extras_mensais_min').eq('colaborador_id', colaboradorId),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
    supabase.rpc('revelar_dados_colaborador', { p_colaborador: colaboradorId }),
  ]);
  const colab = c as unknown as Colab | null;
  if (!colab) notFound();
  if (pode !== true) {
    return <><Link href={`/empresas/${empresaId}/colaboradores`} className="text-sm font-semibold text-marca hover:underline">← Colaboradores</Link><Aviso tipo="erro">Você não tem permissão para editar colaboradores desta empresa.</Aviso></>;
  }

  const contratos = linhas<Contrato>(ct).sort((a, b) => inicioDe(b.vigencia).localeCompare(inicioDe(a.vigencia)));
  const atual = contratos[0];
  const dados = linhas<{ cpf: string | null; telefone: string | null }>(pii)[0];
  const cpf = (dados?.cpf ?? '').replace(/\D/g, '');

  // acesso ao app: o convite pendente só é consultado na aba que o mostra
  let acesso: Acesso = { estado: colab.usuario_id ? 'com' : 'sem' };
  if (aba === 'acesso' && !colab.usuario_id) {
    const { data: cv } = await supabase.from('convite_colaborador').select('email').eq('colaborador_id', colaboradorId).is('aceito_em', null).gt('expira_em', new Date().toISOString()).limit(1);
    const conv = linhas<{ email: string }>(cv)[0];
    if (conv) acesso = { estado: 'pendente', email: conv.email };
  }

  return (
    <TelaColaborador
      empresaId={empresaId} colaboradorId={colaboradorId} aba={aba} acesso={acesso} hoje={dataDeInstante(new Date())} contratos={contratos}
      colab={{ nome: colab.nome, cargo: colab.cargo, setor: colab.setor?.nome ?? null, admissao: colab.admissao, desligamento: colab.desligamento }}
      cpfMascarado={cpf.length === 11 ? `•••.•••.•••-${cpf.slice(9)}` : '—'}
      valoresPessoa={{ nome: colab.nome, setor: colab.setor?.nome ?? '', matricula: colab.matricula ?? '', cargo: colab.cargo ?? '', cbo: colab.cbo ?? '', escolaridade: colab.escolaridade ?? '', telefone: dados?.telefone ?? '' }}
      valoresContrato={atual ? {
        salario: reaisParaTexto(atual.salario_base), jornada_semanal: minutosParaHoras(atual.jornada_semanal_min), tipo_escala: atual.tipo_escala, turno: atual.turno ?? '',
        divisor: String(atual.divisor), folgas_semana: atual.folgas_semana === null ? '' : String(atual.folgas_semana), horas_extras_mensais: atual.horas_extras_mensais_min ? minutosParaHoras(atual.horas_extras_mensais_min) : '',
      } : {}}
    />
  );
}
