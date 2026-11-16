import { Selo } from '@/components/ui';
import { horasTexto, saldoTexto } from '@/lib/banco-horas-ui';
import { dataBr } from '@jc/rules-engine';
import type { SaldoBanco } from '@jc/servicos';

/** Saldo, créditos a vencer, vencidos e lotes em aberto (usado no RH e no app do colaborador). */
export function ResumoSaldo({ saldo, valorVencido }: { saldo: SaldoBanco; valorVencido?: number }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Numero rotulo="Saldo" valor={saldoTexto(saldo.saldoMin)} tom={saldo.saldoMin < 0 ? 'vermelho' : undefined} />
        <Numero rotulo="Vence em 30 dias" valor={horasTexto(saldo.aVencerMin)} tom={saldo.aVencerMin > 0 ? 'amarelo' : undefined} />
        <Numero rotulo="Vencido a pagar" valor={horasTexto(saldo.vencidoMin)} tom={saldo.vencidoMin > 0 ? 'vermelho' : undefined} sub={valorVencido ? `≈ ${(valorVencido / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} com adicional` : undefined} />
        <Numero rotulo="Próximo vencimento" valor={saldo.proximoVencimento ? dataBr(saldo.proximoVencimento.venceEm) : '—'} sub={saldo.proximoVencimento ? horasTexto(saldo.proximoVencimento.minutos) : undefined} />
      </div>
      {saldo.lotes.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-sm">
          {saldo.lotes.map((l) => <li key={l.venceEm + l.minutos} className="rounded-full border border-linha bg-fundo px-3 py-1">{horasTexto(l.minutos)} · vence em {dataBr(l.venceEm)}</li>)}
        </ul>
      ) : null}
      {saldo.negativoMin > 0 ? <Selo tom="vermelho">Saldo negativo permitido pelo acordo: {horasTexto(saldo.negativoMin)}</Selo> : null}
    </div>
  );
}

function Numero({ rotulo, valor, tom, sub }: { rotulo: string; valor: string; tom?: 'vermelho' | 'amarelo'; sub?: string }) {
  const cor = tom === 'vermelho' ? 'text-risco-fg' : tom === 'amarelo' ? 'text-atencao-fg' : '';
  return (
    <div className="rounded-2xl border border-linha bg-cartao px-4 py-2.5">
      <p className="text-xs font-semibold text-suave">{rotulo}</p>
      <p className={`text-2xl font-bold ${cor}`}>{valor}</p>
      {sub ? <p className="text-xs text-suave">{sub}</p> : null}
    </div>
  );
}
