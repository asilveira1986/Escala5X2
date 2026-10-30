import Link from 'next/link';
import { ROTULO_PORTE, ROTULO_STATUS, type EmpresaRow } from '@/lib/tipos-db';
import { formatarCnpj } from '@jc/connectors/parsers';
import { IconeEmpresa, IconeSeta } from './icones';
import { Selo } from './ui';

const tom = { nao_iniciado: 'cinza', em_risco: 'amarelo', adequado: 'verde' } as const;
const acao = { nao_iniciado: 'Começar', em_risco: 'Ver diagnóstico', adequado: 'Ver diagnóstico' } as const;

export function CartaoEmpresa({ empresa: e }: { empresa: Pick<EmpresaRow, 'id' | 'razao_social' | 'cnpj' | 'porte' | 'uf' | 'status_adequacao'> }) {
  const destino = e.status_adequacao === 'nao_iniciado' ? 'colaboradores' : 'diagnostico';
  return (
    <Link href={`/empresas/${e.id}/${destino}`} className="group flex flex-col gap-3 rounded-3xl border border-linha bg-cartao p-4 shadow-[0_2px_8px_rgba(16,32,30,0.05)] transition-colors hover:border-marca">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-marca-suave text-marca"><IconeEmpresa /></span>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold leading-snug" title={e.razao_social}>{e.razao_social}</h3>
          <p className="text-sm text-suave">{formatarCnpj(e.cnpj)} · {ROTULO_PORTE[e.porte]} · {e.uf}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between">
        <Selo tom={tom[e.status_adequacao]}>{ROTULO_STATUS[e.status_adequacao]}</Selo>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-marca">{acao[e.status_adequacao]} <IconeSeta width={16} height={16} className="transition-transform group-hover:translate-x-0.5" /></span>
      </div>
    </Link>
  );
}
