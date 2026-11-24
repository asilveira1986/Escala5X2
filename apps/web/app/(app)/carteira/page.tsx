import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EstadoVazio } from '@/components/EstadoVazio';
import { ResumoItem } from '@/components/ItemTela';
import { Aviso, CabecalhoPagina, Cartao, classeBotaoLink } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { diasAte, FILTROS, filtrar, lerFiltro, lerMes, mesVizinho, ordenarPorAtencao, pendencias, resumir, type LinhaCarteira } from '@/lib/carteira';
import { lerDaterange } from '@/lib/cobertura';
import { dataBr, dataDeInstante } from '@jc/rules-engine';
import { formatarCnpj } from '@jc/connectors/parsers';
import { TabelaCarteira, type LinhaEmpresaCarteira } from './TabelaCarteira';

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const rotuloMes = (m: string) => `${NOMES_MES[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`;

export default async function Carteira({ searchParams }: { searchParams: Promise<{ filtro?: string; mes?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await exigirUsuario();
  const { data: gestao } = await supabase.rpc('minhas_organizacoes_gestao');
  if (!Array.isArray(gestao) || gestao.length === 0) redirect('/empresas'); // painel é só para quem gere empresas
  const hoje = dataDeInstante(new Date());
  const { mes, dia } = lerMes(sp.mes, hoje);
  const filtro = lerFiltro(sp.filtro);
  const [{ data, error }, { data: regra }] = await Promise.all([
    supabase.rpc('painel_carteira', { p_mes: dia }),
    supabase.from('regra_jornada').select('vigencia').eq('codigo', 'EC141_F1').limit(1),
  ]);
  const todas = linhas<LinhaCarteira>(data);
  const resumo = resumir(todas);
  const lista = ordenarPorAtencao(filtrar(todas, filtro));
  const prazo = lerDaterange(linhas<{ vigencia: string }>(regra)[0]?.vigencia ?? '')?.inicio;
  const faltam = prazo ? diasAte(prazo, hoje) : null;
  const dados: LinhaEmpresaCarteira[] = lista.map((l) => ({
    id: l.empresa_id, razao: l.razao_social, cnpj: formatarCnpj(l.cnpj), uf: l.uf, pessoas: l.colaboradores, status: l.status_adequacao,
    pendencias: pendencias(l).map((p) => ({ codigo: p.codigo, texto: p.texto, href: `/empresas/${l.empresa_id}/${p.aba}` })),
  }));
  const href = (f: string, m = mes) => `/carteira?filtro=${f}&mes=${m}`;

  return (
    <>
      <CabecalhoPagina icone="carteira" titulo="Carteira" descricao="Suas empresas, das que mais precisam de atenção para as que estão em dia."
        acoes={<a href={`/api/v1/carteira?mes=${mes}`} className={classeBotaoLink}>Baixar planilha</a>} />

      {faltam != null && prazo ? (
        <Aviso tipo={faltam <= 0 ? 'ok' : faltam <= 45 ? 'erro' : 'info'}>
          {faltam > 0 ? `Faltam ${faltam} dia${faltam === 1 ? '' : 's'} para a 1ª fase da nova jornada (${dataBr(prazo)}).` : `A 1ª fase da nova jornada está em vigor desde ${dataBr(prazo)}.`}
        </Aviso>
      ) : null}
      {error ? <Aviso tipo="erro">Não foi possível carregar a carteira agora. Tente novamente.</Aviso> : null}

      <ResumoItem rotulo="Resumo da carteira" itens={[
        { rotulo: 'Empresas', valor: <span className="horario">{resumo.empresas}<span className="font-[family-name:var(--font-texto)] text-xs font-medium text-suave"> · {resumo.pessoas} pessoas</span></span> },
        { rotulo: 'Pedem atenção', valor: <span className={`horario ${resumo.atencao > 0 ? 'text-atencao-fg' : 'text-ok-fg'}`}>{resumo.atencao}</span> },
        { rotulo: 'Em risco', valor: <span className={`horario ${resumo.emRisco > 0 ? 'text-risco-fg' : 'text-ok-fg'}`}>{resumo.emRisco}</span> },
        { rotulo: 'Ciências pendentes', valor: <span className={`horario ${resumo.cienciasPendentes > 0 ? 'text-atencao-fg' : 'text-ok-fg'}`}>{resumo.cienciasPendentes}<span className="font-[family-name:var(--font-texto)] text-xs font-medium text-suave"> · escala de {rotuloMes(mes)}</span></span> },
      ]} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Filtrar empresas" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <Link key={f.id} href={href(f.id)} aria-current={filtro === f.id ? 'page' : undefined}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${filtro === f.id ? 'border-marca bg-marca text-sobre-marca' : 'border-linha bg-cartao hover:bg-marca-suave'}`}>{f.rotulo}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 text-sm font-semibold" aria-label="Mês das escalas">
          <Link href={href(filtro, mesVizinho(mes, -1))} aria-label="Mês anterior" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">‹</Link>
          <span className="min-w-36 text-center">{rotuloMes(mes)}</span>
          <Link href={href(filtro, mesVizinho(mes, 1))} aria-label="Próximo mês" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">›</Link>
        </div>
      </div>

      <Cartao icone="carteira" titulo={`${lista.length} ${lista.length === 1 ? 'empresa' : 'empresas'}`} subtitulo={todas.length === 0 ? 'Cadastre empresas ou peça o vínculo do escritório às empresas clientes.' : `Das que mais precisam de atenção para as em dia. Pendências e escalas de ${rotuloMes(mes)}.`}>
        <TabelaCarteira dados={dados} />
      </Cartao>
    </>
  );
}
