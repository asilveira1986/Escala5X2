import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { NavEmpresa } from '@/components/NavEmpresa';
import { Selo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { ROTULO_STATUS, type EmpresaRow } from '@/lib/tipos-db';
import { formatarCnpj } from '@jc/connectors/parsers';

const tom = { nao_iniciado: 'cinza', em_risco: 'amarelo', adequado: 'verde' } as const;

export default async function EmpresaLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const id = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('empresa').select('id, razao_social, cnpj, status_adequacao').eq('id', id).maybeSingle();
  const empresa = linhas<EmpresaRow>(data ? [data] : [])[0];
  if (!empresa) notFound();
  return (
    <>
      <div className="space-y-3">
        <Link href="/empresas" className="inline-flex min-h-10 items-center text-sm font-semibold text-marca hover:underline">← Todas as empresas</Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{empresa.razao_social}</h1>
          <Selo tom={tom[empresa.status_adequacao]}>{ROTULO_STATUS[empresa.status_adequacao]}</Selo>
        </div>
        <p className="text-sm text-suave">CNPJ {formatarCnpj(empresa.cnpj)}</p>
      </div>
      <NavEmpresa empresaId={id} />
      {children}
    </>
  );
}
