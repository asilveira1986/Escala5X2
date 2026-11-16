import { Cartao, Selo } from '@/components/ui';
import { horasLiquidasMin, semanasDoPeriodo, textoTurno, type EscalaPublicada } from '@/lib/minha-escala';
import { dataBr, diaDaSemana, duracao } from '@jc/rules-engine';
import { BotaoCiencia } from './BotaoCiencia';

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function BlocoEscala({ e, hoje }: { e: EscalaPublicada; hoje: string }) {
  const porDia = new Map(e.dias.map((d) => [d.data, d]));
  const trabalho = e.dias.filter((d) => d.tipo === 'trabalho');
  const total = trabalho.reduce((s, d) => s + horasLiquidasMin(d), 0);
  return (
    <Cartao>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{e.nome} <span className="font-normal text-suave">· versão {e.versao}</span></h2>
          <p className="text-sm text-suave">{dataBr(e.inicio)} a {dataBr(e.fim)}{e.publicadaEm ? ` · publicada em ${dataBr(e.publicadaEm.slice(0, 10))}` : ''}</p>
        </div>
        {e.cienteEm ? <Selo tom="verde">Ciente em {dataBr(e.cienteEm.slice(0, 10))}</Selo> : <Selo tom="amarelo">Aguardando sua ciência</Selo>}
      </div>
      <p className="mt-2 text-sm">{trabalho.length} dia(s) de trabalho · {duracao(total)} no período</p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[19rem] table-fixed border-separate border-spacing-1 text-center text-xs">
          <thead><tr>{DIAS.map((d) => <th key={d} scope="col" className="pb-0.5 text-[11px] font-semibold uppercase text-suave">{d}</th>)}</tr></thead>
          <tbody>
            {semanasDoPeriodo(e.inicio, e.fim).map((sem, i) => (
              <tr key={i}>
                {sem.map((d, j) => {
                  if (!d) return <td key={j} />;
                  const a = porDia.get(d);
                  const trab = a?.tipo === 'trabalho';
                  return (
                    <td key={d} aria-label={`${dataBr(d)}: ${a ? textoTurno(a) : 'sem lançamento'}`}
                      className={`h-14 rounded-xl px-0.5 align-top ${trab ? 'bg-marca-suave text-marca' : a ? 'bg-neutro-bg text-neutro-fg' : 'border border-dashed border-linha text-suave'} ${d === hoje ? 'outline outline-2 outline-marca' : ''}`}>
                      <span className="block pt-0.5 text-[11px] font-semibold">{d.slice(8)}</span>
                      <span className="block text-[11px] font-semibold leading-tight">{trab ? `${String(Math.floor((a!.inicioMin ?? 0) / 60)).padStart(2, '0')}:${String((a!.inicioMin ?? 0) % 60).padStart(2, '0')}` : a ? (a.tipo === 'folga' ? 'Folga' : a.tipo === 'ferias' ? 'Férias' : a.tipo === 'dsr' ? 'DSR' : a.tipo === 'feriado' ? 'Feriado' : 'Afast.') : ''}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="mt-3">
        <summary className="min-h-9 cursor-pointer text-sm font-semibold text-marca">Ver dia a dia</summary>
        <ul className="mt-2 divide-y divide-linha">
          {e.dias.map((d, i) => (
            <li key={`${d.data}-${i}`} className="flex flex-wrap justify-between gap-x-3 py-1.5 text-sm">
              <span className="font-semibold">{DIAS[diaDaSemana(d.data)]}, {dataBr(d.data)}</span><span className="text-suave">{textoTurno(d)}</span>
            </li>
          ))}
        </ul>
      </details>

      {!e.cienteEm ? (
        <div className="mt-4 space-y-2 rounded-2xl bg-fundo p-3">
          <p className="text-sm">Ao confirmar, fica registrado que você leu esta escala (data, hora e código de verificação).</p>
          <BotaoCiencia escalaId={e.id} />
        </div>
      ) : null}
      {e.hash ? <p className="mt-3 break-all text-[11px] text-suave">Código de verificação: {e.hash.slice(0, 16)}…</p> : null}
    </Cartao>
  );
}
