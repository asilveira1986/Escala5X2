import Link from 'next/link';
import { CabecalhoItem } from '@/components/ItemTela';
import { Aviso, Cartao, classeBotaoLink } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { dataDeInstante } from '@jc/rules-engine';
import { FormNovaEscala } from '../FormNovaEscala';

const PASSOS = [
  { n: 1, titulo: 'Crie a escala', texto: 'Escolha o nome, o mês e, se quiser, o setor.' },
  { n: 2, titulo: 'Monte a grade', texto: 'Pinte os turnos à mão ou peça propostas automáticas que já respeitam a lei.' },
  { n: 3, titulo: 'Publique', texto: 'Os avisos da lei aparecem na hora; ao publicar, a equipe vê e confirma a ciência.' },
];

export default async function NovaEscala({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [mod, set] = await Promise.all([
    supabase.from('turno_modelo').select('id').eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome'),
  ]);
  const semTurnos = linhas<{ id: string }>(mod.data).length === 0;
  const setores = linhas<{ id: string; nome: string }>(set.data).map((s) => ({ id: s.id, nome: s.nome }));
  return (
    <>
      <CabecalhoItem icone="mais" titulo="Nova escala" subtitulo="Monte o mês: veja os avisos da lei na hora e publique quando estiver tudo certo."
        selo={<Link href={`/empresas/${empresaId}/escalas`} className={classeBotaoLink}>Voltar às escalas</Link>} />
      {semTurnos ? <Aviso tipo="info">Cadastre pelo menos um turno para poder montar a escala. <Link className="font-semibold underline" href={`/empresas/${empresaId}/escalas/turnos/novo`}>Cadastrar turno</Link></Aviso> : null}
      <Cartao icone="escalas" titulo="Dados da escala" subtitulo="Dá para mudar tudo na grade depois; o mês e o setor definem quem entra.">
        <FormNovaEscala empresaId={empresaId} mesPadrao={dataDeInstante(new Date()).slice(0, 7)} setores={setores} />
      </Cartao>
      <Cartao titulo="Como funciona">
        <ol className="grid gap-3 sm:grid-cols-3">
          {PASSOS.map((p) => (
            <li key={p.n} className="flex items-start gap-2.5">
              <span aria-hidden className="horario grid size-7 shrink-0 place-items-center rounded-full bg-marca-suave text-sm font-bold text-marca">{p.n}</span>
              <div><p className="text-sm font-semibold">{p.titulo}</p><p className="text-sm text-suave">{p.texto}</p></div>
            </li>
          ))}
        </ol>
      </Cartao>
    </>
  );
}
