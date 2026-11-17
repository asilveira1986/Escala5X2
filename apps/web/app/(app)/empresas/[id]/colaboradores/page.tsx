import Link from 'next/link';
import { Aviso, Cartao, classeBotaoLinkPrimario } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { todasAsLinhas } from '@/lib/paginar';
import type { ColaboradorVigenteRow, LinhaEquipe } from '@/lib/tipos-db';
import { TabelaColaboradores } from './TabelaColaboradores';

const LIMITE = 5000;

export default async function Colaboradores({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  // O Supabase corta cada consulta em 1000 linhas: lê por páginas.
  const equipe = await todasAsLinhas<ColaboradorVigenteRow>((a, b) => supabase.from('vw_colaborador_vigente')
    .select('colaborador_id, nome, matricula, cargo, setor_nome, turno, salario_base, jornada_semanal_min, divisor, tipo_escala, hipersuficiente')
    .eq('empresa_id', empresaId).order('nome').range(a, b), { maximo: LIMITE });
  const data = equipe.linhas, error = equipe.erro;
  const base = linhas<ColaboradorVigenteRow>(data);
  // Acesso ao app: quem já tem usuário ligado e quem tem convite pendente (só a gestão enxerga convites).
  const [{ data: vinc }, { data: conv }, { data: podeGerirRpc }] = await Promise.all([
    todasAsLinhas<{ id: string; usuario_id: string }>((a, b) => supabase.from('colaborador').select('id, usuario_id').eq('empresa_id', empresaId).not('usuario_id', 'is', null).order('id').range(a, b), { maximo: LIMITE }).then((r) => ({ data: r.linhas })),
    supabase.from('convite_colaborador').select('colaborador_id, email, expira_em').is('aceito_em', null).gt('expira_em', new Date().toISOString()),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const com = new Set(linhas<{ id: string }>(vinc).map((c) => c.id));
  const pendentes = new Map(linhas<{ colaborador_id: string; email: string }>(conv).map((c) => [c.colaborador_id, c.email]));
  const dados: LinhaEquipe[] = base.map((c) => ({
    ...c,
    acesso: com.has(c.colaborador_id) ? { estado: 'com' } : pendentes.has(c.colaborador_id) ? { estado: 'pendente', email: pendentes.get(c.colaborador_id) } : { estado: 'sem' },
  }));
  return (
    <Cartao titulo={`Colaboradores (${dados.length})`}>
      {error ? <Aviso tipo="erro">Não foi possível carregar os colaboradores.</Aviso> : null}
      {dados.length >= LIMITE ? <Aviso>Exibindo os primeiros {LIMITE} colaboradores.</Aviso> : null}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {podeGerirRpc === true ? <Link className={classeBotaoLinkPrimario} href={`/empresas/${empresaId}/colaboradores/novo`}>Novo colaborador</Link> : null}
        <Link className="text-marca hover:underline" href={`/empresas/${empresaId}/importar`}>Importar ou atualizar por planilha</Link>
      </div>
      <TabelaColaboradores dados={dados} empresaId={empresaId} podeGerir={podeGerirRpc === true} />
    </Cartao>
  );
}
