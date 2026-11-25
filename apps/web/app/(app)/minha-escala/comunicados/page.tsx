import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { Cartao, classeBotaoLink, Selo } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { textoComunicado } from '@jc/documents/comunicado';
import { BotaoCienciaComunicado } from './BotaoCienciaComunicado';

type Linha = { id: string; fase: 'F1' | 'F2'; inicio: string; jornada_atual_min: number; nova_jornada_min: number; dias_trabalho: number; dias_repouso: number; emitido_em: string; ciente_em: string | null };
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

/** Comunicados de adequação da jornada dirigidos à própria pessoa (o RLS deixa gestores verem os de todos; esta tela filtra pelo colaborador do login). */
export default async function MeusComunicados() {
  const { supabase, user } = await exigirUsuario();
  const { data: colabs } = await supabase.from('colaborador').select('id, nome').eq('usuario_id', user.id);
  const meus = linhas<{ id: string; nome: string }>(colabs);
  const { data } = meus.length === 0 ? { data: [] } : await supabase.from('comunicado_jornada')
    .select('id, fase, inicio, jornada_atual_min, nova_jornada_min, dias_trabalho, dias_repouso, emitido_em, ciente_em').in('colaborador_id', meus.map((c) => c.id)).order('inicio');
  const lista = linhas<Linha>(data).sort((a, b) => Number(!!a.ciente_em) - Number(!!b.ciente_em) || b.inicio.localeCompare(a.inicio));   // os que esperam ciência primeiro
  const nome = meus[0]?.nome ?? '';
  return (
    <>
      <CabecalhoItem icone="pedidos" titulo="Comunicados" subtitulo="Avisos da empresa sobre a mudança da sua jornada de trabalho." selo={<Link href="/minha-escala" className={classeBotaoLink}>Minha escala</Link>} />
      {lista.length > 0 ? <ResumoItem rotulo="Resumo dos comunicados" itens={[
        { rotulo: 'Comunicados', valor: <span className="horario">{lista.length}</span> },
        { rotulo: 'Aguardando ciência', valor: <span className={`horario ${lista.some((c) => !c.ciente_em) ? 'text-atencao-fg' : 'text-ok-fg'}`}>{lista.filter((c) => !c.ciente_em).length}</span> },
      ]} /> : null}
      {lista.length === 0 ? <Cartao><EstadoVazio titulo="Nenhum comunicado">Quando a empresa emitir um comunicado sobre a sua jornada, ele aparece aqui.</EstadoVazio></Cartao> : lista.map((c) => {
        const paragrafos = textoComunicado({ empresa: { razaoSocial: '', cnpj: '' }, fase: { rotulo: c.fase === 'F1' ? 'Fase 1' : 'Fase 2', inicio: c.inicio, diasTrabalho: c.dias_trabalho, diasRepouso: c.dias_repouso }, geradoEm: '', itens: [] },
          { nome, setor: null, jornadaAtualMin: c.jornada_atual_min, novaJornadaMin: c.nova_jornada_min });
        return (
          <Cartao key={c.id} icone="pedidos" titulo={`Adequação da jornada · ${c.fase === 'F1' ? 'fase 1' : 'fase 2'}`} subtitulo={`Emitido em ${quando(c.emitido_em)}`} acoes={<Selo tom={c.ciente_em ? 'verde' : 'amarelo'}>{c.ciente_em ? 'Ciência registrada' : 'Aguardando a sua ciência'}</Selo>}>
            <div className="space-y-2 text-sm">{paragrafos.map((t, i) => <p key={i}>{t}</p>)}</div>
            <div className="mt-4">{c.ciente_em ? <p className="text-sm text-ok-fg">Você confirmou a ciência em {quando(c.ciente_em)}.</p> : <BotaoCienciaComunicado id={c.id} />}</div>
          </Cartao>
        );
      })}
    </>
  );
}
