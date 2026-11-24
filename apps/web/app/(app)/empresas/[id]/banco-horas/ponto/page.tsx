import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { ResumoItem } from '@/components/ItemTela';
import { Aviso, Cartao } from '@/components/ui';
import { calcularApuracao } from '@/lib/banco-ponto-dados';
import { mesVizinho } from '@/lib/carteira';
import { horasTexto, saldoTexto } from '@/lib/banco-horas-ui';
import { exigirUsuario, idOu404 } from '@/lib/contexto';
import { lerCompetencia, rotuloMes } from '@/lib/folha-ui';
import { dataDeInstante } from '@jc/rules-engine';
import { ListaApuracao } from './ListaApuracao';

export default async function BancoPeloPonto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const empresaId = idOu404((await params).id);
  const hoje = dataDeInstante(new Date());
  const { mes } = lerCompetencia((await searchParams).mes, hoje);
  const { supabase } = await exigirUsuario();
  const [{ data: ger }, ap] = await Promise.all([
    supabase.rpc('pode_gerir_empresa', { p_empresa: empresaId }),
    calcularApuracao(supabase, empresaId, mes).then((r) => ({ ok: true as const, ...r }), () => ({ ok: false as const })),
  ]);
  const href = (m: string) => `/empresas/${empresaId}/banco-horas/ponto?mes=${m}`;
  const futuro = mes > hoje.slice(0, 7);
  const disponiveis = ap.ok ? ap.itens.filter((i) => !i.jaLancado) : [];
  const creditos = disponiveis.filter((i) => i.minutos > 0).reduce((t, i) => t + i.minutos, 0), debitos = disponiveis.filter((i) => i.minutos < 0).reduce((t, i) => t + i.minutos, 0);

  return (
    <>
      <Cartao icone="banco" titulo="Apuração do mês" subtitulo="Compara o que cada pessoa trabalhou (marcações do relógio) com o que a escala previa e propõe lançar a diferença no banco de horas. Você confere e marca o que entra."
        acoes={
          <div className="flex items-center gap-1 text-sm font-semibold">
            <Link href={href(mesVizinho(mes, -1))} aria-label="Mês anterior" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">‹</Link>
            <span className="min-w-36 text-center">{rotuloMes(mes)}</span>
            {mes < hoje.slice(0, 7) ? <Link href={href(mesVizinho(mes, 1))} aria-label="Próximo mês" className="grid size-9 place-items-center rounded-full hover:bg-marca-suave">›</Link> : <span className="size-9" />}
          </div>}>
        <details className="group text-sm">
          <summary className="cursor-pointer font-semibold text-marca hover:underline">Como a apuração funciona</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-suave">
            <li>Só entram dias com marcação completa e diferença acima da tolerância da CLT (5 min por marcação, 10 min por dia), e trabalho em dia de folga.</li>
            <li>Dia sem marcação, marcação incompleta e dias de férias/afastamento <strong>não</strong> geram lançamento: falta e abono são decisão sua, no banco de horas do colaborador.</li>
            <li>Horas a mais só viram crédito para quem tem acordo com banco de horas vigente; as demais são pagas como hora extra na folha. Crédito lançado aqui sai das horas extras a pagar no fechamento da folha pelo ponto.</li>
          </ul>
        </details>
      </Cartao>

      {futuro ? <Aviso>Este mês ainda não começou.</Aviso> : null}
      {!ap.ok ? <Aviso tipo="erro">Não foi possível apurar este mês agora. Recarregue a página.</Aviso> : null}
      {ap.ok && !ap.completo ? <Aviso tipo="erro">Não foi possível ler todos os dados do mês: o resultado pode estar incompleto. Recarregue a página antes de lançar.</Aviso> : null}
      {ap.ok && !ap.temEscala && !futuro ? <Aviso>Nenhuma escala publicada cobre {rotuloMes(mes)}: não há o que comparar com o ponto.</Aviso> : null}
      {ap.ok && ap.temEscala && !ap.temMarcacoes ? <Aviso>Não há marcações de ponto importadas para {rotuloMes(mes)}. Importe o AFD em <Link className="font-semibold underline" href={`/empresas/${empresaId}/ponto?mes=${mes}`}>Ponto (AFD)</Link>.</Aviso> : null}

      {ap.ok && ap.temEscala && ap.temMarcacoes ? (
        <>
          <ResumoItem rotulo="Resumo da apuração" itens={[
            { rotulo: 'Dias com diferença', valor: <span className="horario">{ap.itens.length}{ap.itens.length - disponiveis.length > 0 ? <span className="font-[family-name:var(--font-texto)] text-xs font-medium text-suave"> · {ap.itens.length - disponiveis.length} já lançados</span> : null}</span> },
            { rotulo: 'Horas a mais', valor: <span className="horario text-ok-fg">{horasTexto(creditos)}</span> },
            { rotulo: 'Horas a menos', valor: <span className={`horario ${debitos < 0 ? 'text-risco-fg' : ''}`}>{horasTexto(Math.abs(debitos))}</span> },
            { rotulo: 'Saldo proposto', valor: <span className="horario">{saldoTexto(creditos + debitos)}</span> },
          ]} />
          <Cartao icone="relogio" titulo={`Dias a lançar · ${rotuloMes(mes)}`}>
            {ap.itens.length === 0 ? <EstadoVazio titulo="Nenhuma diferença acima da tolerância">Tudo o que foi marcado ficou dentro do previsto na escala.</EstadoVazio> : (
              <ListaApuracao key={mes} empresaId={empresaId} mes={mes} podeGerir={ger === true} linhas={ap.itens} />
            )}
          </Cartao>
        </>
      ) : null}
    </>
  );
}
