import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao, Selo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { agruparPorDia, rotuloFaixa, type Demanda } from '@/lib/cobertura';
import { removerDemanda } from './actions';
import { BotaoRemover } from './BotaoRemover';
import { FormDemanda } from './FormDemanda';

export default async function Cobertura({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [dem, set, ger] = await Promise.all([
    supabase.from('demanda_cobertura').select('id, setor_id, dia_semana, faixa_inicio_min, faixa_fim_min, minimo, ideal').eq('empresa_id', empresaId).limit(500),
    supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome'),
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
  ]);
  const demandas = linhas<Demanda>(dem.data);
  const setores = linhas<{ id: string; nome: string }>(set.data).map((s) => ({ id: s.id, nome: s.nome }));
  const nomeSetor = new Map(setores.map((s) => [s.id, s.nome]));
  const podeGerir = ger.data === true;
  const grupos = agruparPorDia(demandas);
  return (
    <>
      <Cartao icone="cobertura" subtitulo="Quantas pessoas precisam estar trabalhando em cada faixa de horário. O editor avisa quando a grade fica abaixo do mínimo (nunca impede de publicar). Faixa de um setor vale só para escalas desse setor; faixa da empresa toda vale para escalas da empresa toda.">
        {podeGerir ? <FormDemanda empresaId={empresaId} setores={setores} /> : <p className="text-sm text-suave">Só quem gere a empresa pode alterar a cobertura.</p>}
      </Cartao>
      <Cartao icone="cobertura" titulo="Faixas cadastradas">
        {grupos.length === 0 ? <EstadoVazio titulo="Nenhuma faixa ainda">Sem cobertura cadastrada, o editor não confere quantas pessoas há em cada horário.</EstadoVazio> : (
          <div className="space-y-4">
            {grupos.map((g) => (
              <section key={g.dia.n}>
                <h3 className="text-sm font-bold">{g.dia.longo}</h3>
                <ul className="mt-1 divide-y divide-linha">
                  {g.itens.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold">{rotuloFaixa(d)}</span>
                        <span>mínimo {d.minimo}{d.ideal != null ? `, ideal ${d.ideal}` : ''}</span>
                        <Selo tom={d.setor_id ? 'azul' : 'cinza'}>{d.setor_id ? nomeSetor.get(d.setor_id) ?? 'Setor' : 'Empresa toda'}</Selo>
                      </span>
                      {podeGerir ? <BotaoRemover rotulo={`Remover faixa ${rotuloFaixa(d)} de ${g.dia.longo}`} confirmacao="Remover esta faixa de cobertura?" acao={removerDemanda.bind(null, empresaId, d.id)} /> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Cartao>
    </>
  );
}
