import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Aviso, CabecalhoPagina, classeBotaoLink } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { selecionarComunicados } from '@/lib/comunicados';
import { resumirProntidao } from '@/lib/prontidao';
import { chamar, lerEntradaDiagnostico } from '@jc/servicos';
import { dataDeInstante, diagnosticar, type Diagnostico } from '@jc/rules-engine';
import { Prontidao } from './Prontidao';

/** Só o que a simulação de custo usa; nomes e textos ficam no servidor para a página continuar leve com equipes grandes. */
const enxuto = (d: Diagnostico): Diagnostico => ({
  ...d,
  itens: d.itens.map((i) => ({ ...i, nome: '', alertas: [], f1: i.f1 ? { ...i.f1, motivos: [], regrasAplicadas: [] } : null, f2: { ...i.f2, motivos: [], regrasAplicadas: [] } })),
});

export default async function PaginaProntidao({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const hoje = dataDeInstante(new Date());
  let diag: Diagnostico | null = null;
  let comunicados = { F1: 0, F2: 0 };
  let falha = false;
  // situação dos comunicados já emitidos (se o SQL de comunicados ainda não foi aplicado, a consulta falha e a seção some)
  const { data: emitidos } = await supabase.from('comunicado_jornada').select('fase, ciente_em, colaborador(nome)').eq('empresa_id', empresaId).limit(2000);
  const emissao = Array.isArray(emitidos) ? linhas<{ fase: 'F1' | 'F2'; ciente_em: string | null; colaborador: { nome: string } | { nome: string }[] | null }>(emitidos).map((x) => ({ fase: x.fase, ciente: !!x.ciente_em, nome: (Array.isArray(x.colaborador) ? x.colaborador[0]?.nome : x.colaborador?.nome) ?? 'Colaborador' })) : null;
  try {
    const entrada = lerEntradaDiagnostico(await chamar(supabase, 'diagnostico_entrada', { p_empresa: empresaId, p_data: hoje }));
    if (entrada.colaboradores.length > 0) {
      diag = diagnosticar(entrada.colaboradores, hoje, entrada.regras);
      comunicados = { F1: selecionarComunicados(diag, entrada.regras, 'F1', null)?.itens.length ?? 0, F2: selecionarComunicados(diag, entrada.regras, 'F2', null)?.itens.length ?? 0 };
    }
  } catch { falha = true; }
  return (
    <>
      <CabecalhoPagina icone="calendario" titulo="Prontidão para a EC 141" descricao="Quão preparada a empresa está para a fase 1 (42h) e para a fase 2 (40h), por setor, e quanto custa cobrir as horas." />
      {falha ? <Aviso tipo="erro">Não foi possível calcular a prontidão agora. Tente novamente.</Aviso> : null}
      {!falha && !diag ? (
        <EstadoVazio titulo="Ainda não há equipe com contrato vigente">
          <Link href={`/empresas/${empresaId}/importar`} className={classeBotaoLink}>Importar planilha</Link>
        </EstadoVazio>
      ) : null}
      {diag ? <Prontidao empresaId={empresaId} d={enxuto(diag)} p={resumirProntidao(diag, hoje)} comunicados={comunicados} emissao={emissao} /> : null}
    </>
  );
}
