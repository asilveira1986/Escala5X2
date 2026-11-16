import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao, Selo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { lerDaterange } from '@/lib/cobertura';
import { dataBr } from '@jc/rules-engine';
import { BotaoRemover } from '../cobertura/BotaoRemover';
import { removerAusencia } from './actions';
import { FormAusencia } from './FormAusencia';

type Linha = { id: string; colaborador_id: string; periodo: string; tipo: 'ferias' | 'afastamento'; observacao: string | null };

export default async function Ausencias({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [aus, col, ger] = await Promise.all([
    supabase.from('ausencia').select('id, colaborador_id, periodo, tipo, observacao').eq('empresa_id', empresaId).order('periodo', { ascending: false }).limit(300),
    supabase.from('colaborador').select('id, nome, desligamento').eq('empresa_id', empresaId).order('nome').limit(5000),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const colaboradores = linhas<{ id: string; nome: string; desligamento: string | null }>(col.data);
  const nome = new Map(colaboradores.map((c) => [c.id, c.nome]));
  const lista = linhas<Linha>(aus.data).flatMap((a) => { const p = lerDaterange(a.periodo); return p ? [{ ...a, ...p }] : []; })
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
  const podeGerir = ger.data === true;
  return (
    <>
      <Link href={`/empresas/${empresaId}/escalas`} className="inline-flex min-h-9 items-center text-sm font-semibold text-marca hover:underline">← Escalas</Link>
      <Cartao titulo="Férias e afastamentos" subtitulo="Quem está ausente não pode ser escalado: o editor bloqueia a publicação se houver trabalho nesses dias.">
        {podeGerir ? <FormAusencia empresaId={empresaId} colaboradores={colaboradores.filter((c) => !c.desligamento).map((c) => ({ id: c.id, nome: c.nome }))} /> : <p className="text-sm text-suave">Só quem gere a empresa pode lançar ausências.</p>}
      </Cartao>
      <Cartao titulo="Lançamentos">
        {lista.length === 0 ? <EstadoVazio titulo="Nenhuma ausência lançada">Lance as férias programadas para o editor evitar escalar quem está fora.</EstadoVazio> : (
          <ul className="divide-y divide-linha">
            {lista.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{nome.get(a.colaborador_id) ?? 'Colaborador'}</span>
                  <Selo tom={a.tipo === 'ferias' ? 'azul' : 'amarelo'}>{a.tipo === 'ferias' ? 'Férias' : 'Afastamento'}</Selo>
                  <span>{dataBr(a.inicio)} a {dataBr(a.fim)}</span>
                  {a.observacao ? <span className="text-suave">· {a.observacao}</span> : null}
                </span>
                {podeGerir ? <BotaoRemover rotulo={`Remover ausência de ${nome.get(a.colaborador_id) ?? 'colaborador'}`} confirmacao="Remover este lançamento?" acao={removerAusencia.bind(null, empresaId, a.id)} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </>
  );
}
