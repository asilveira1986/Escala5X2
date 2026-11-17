import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso, Cartao, Selo, Titulo } from '@/components/ui';
import { minutosParaHoras, reaisParaTexto } from '@/lib/colaborador-form';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { dataBr, dataDeInstante } from '@jc/rules-engine';
import { FormEditarPessoa } from './FormEditarPessoa';
import { FormMudarContrato } from './FormMudarContrato';
import { PainelDesligamento } from './PainelDesligamento';

type Colab = { id: string; nome: string; matricula: string | null; cargo: string | null; cbo: string | null; escolaridade: string | null; admissao: string; desligamento: string | null; setor: { nome: string } | null };
type Contrato = { id: string; vigencia: string; salario_base: number | string; jornada_semanal_min: number; divisor: number; tipo_escala: string; folgas_semana: number | null; turno: string | null; horas_extras_mensais_min: number };

const inicioDe = (v: string) => /^[\[(](\d{4}-\d{2}-\d{2})/.exec(v)?.[1] ?? '';
/** "[2026-01-05,2026-06-01)" → "05/01/2026 a 31/05/2026"; sem fim → "desde 05/01/2026". */
function periodo(v: string): string {
  const m = /^[\[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})?[\])]$/.exec(v);
  if (!m) return v;
  if (!m[2]) return `desde ${dataBr(m[1]!)}`;
  const fim = new Date(Date.parse(`${m[2]}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${dataBr(m[1]!)} a ${dataBr(fim)}`;
}

export default async function EditarColaborador({ params }: { params: Promise<{ id: string; colaboradorId: string }> }) {
  const p = await params;
  const empresaId = idOu404(p.id), colaboradorId = idOu404(p.colaboradorId);
  const { supabase } = await exigirUsuario();
  const [{ data: c }, { data: ct }, { data: pode }, { data: pii }] = await Promise.all([
    supabase.from('colaborador').select('id, nome, matricula, cargo, cbo, escolaridade, admissao, desligamento, setor:setor_id(nome)').eq('id', colaboradorId).eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('contrato_versao').select('id, vigencia, salario_base, jornada_semanal_min, divisor, tipo_escala, folgas_semana, turno, horas_extras_mensais_min').eq('colaborador_id', colaboradorId),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
    supabase.rpc('revelar_dados_colaborador', { p_colaborador: colaboradorId }),
  ]);
  const colab = c as unknown as Colab | null;
  if (!colab) notFound();
  const voltar = <Link href={`/empresas/${empresaId}/colaboradores`} className="text-sm font-semibold text-marca hover:underline">← Colaboradores</Link>;
  if (pode !== true) return <>{voltar}<Aviso tipo="erro">Você não tem permissão para editar colaboradores desta empresa.</Aviso></>;

  const contratos = linhas<Contrato>(ct).sort((a, b) => inicioDe(b.vigencia).localeCompare(inicioDe(a.vigencia)));
  const atual = contratos[0];
  const dados = linhas<{ cpf: string | null; telefone: string | null }>(pii)[0];
  const cpf = (dados?.cpf ?? '').replace(/\D/g, '');
  const hoje = dataDeInstante(new Date());
  const desligado = colab.desligamento !== null;

  const valoresPessoa = { nome: colab.nome, setor: colab.setor?.nome ?? '', matricula: colab.matricula ?? '', cargo: colab.cargo ?? '', cbo: colab.cbo ?? '', escolaridade: colab.escolaridade ?? '', telefone: dados?.telefone ?? '' };
  const valoresContrato: Record<string, string> = atual ? {
    salario: reaisParaTexto(atual.salario_base), jornada_semanal: minutosParaHoras(atual.jornada_semanal_min), tipo_escala: atual.tipo_escala, turno: atual.turno ?? '',
    divisor: String(atual.divisor), folgas_semana: atual.folgas_semana === null ? '' : String(atual.folgas_semana), horas_extras_mensais: atual.horas_extras_mensais_min ? minutosParaHoras(atual.horas_extras_mensais_min) : '',
  } : {};

  return (
    <>
      {voltar}
      <div className="flex flex-wrap items-center gap-3">
        <Titulo icone="pessoas" descricao={`Admitido em ${dataBr(colab.admissao)}`}>{colab.nome}</Titulo>
        {desligado ? <Selo tom="vermelho">Desligado</Selo> : <Selo tom="verde">Ativo</Selo>}
      </div>
      <Cartao icone="pessoas" titulo="Dados da pessoa">
        <FormEditarPessoa empresaId={empresaId} colaboradorId={colaboradorId} valores={valoresPessoa} cpfMascarado={cpf.length === 11 ? `•••.•••.•••-${cpf.slice(9)}` : '—'} />
      </Cartao>
      <Cartao icone="turnos" titulo="Contrato e escala" subtitulo="Para mudar salário, jornada ou escala, informe a data em que passa a valer. O histórico é mantido.">
        {desligado ? <Aviso>Colaborador desligado: reative para alterar o contrato.</Aviso> : atual
          ? <FormMudarContrato empresaId={empresaId} colaboradorId={colaboradorId} valores={valoresContrato} hoje={hoje} admissao={colab.admissao} />
          : <Aviso>Este colaborador não tem contrato cadastrado.</Aviso>}
        {contratos.length > 0 ? (
          <div className="mt-5">
            <h3 className="mb-1 text-sm font-semibold">Histórico de contratos</h3>
            <ul className="divide-y divide-linha text-sm">
              {contratos.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{periodo(k.vigencia)}</span>
                  <span className="text-suave">R$ {reaisParaTexto(k.salario_base)} · {minutosParaHoras(k.jornada_semanal_min)} h/sem · {k.tipo_escala}{k.turno ? ` · ${k.turno}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Cartao>
      <Cartao titulo={desligado ? 'Desligamento' : 'Desligar colaborador'}>
        <PainelDesligamento empresaId={empresaId} colaboradorId={colaboradorId} nome={colab.nome} desligamento={colab.desligamento} hoje={hoje} admissao={colab.admissao} />
      </Cartao>
    </>
  );
}
