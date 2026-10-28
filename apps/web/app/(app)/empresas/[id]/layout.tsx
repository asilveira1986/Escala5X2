import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { EmpresaRow } from '@/lib/tipos-db';
import { formatarCnpj } from '@jc/connectors';

export default async function EmpresaLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const id = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('empresa').select('id, razao_social, cnpj').eq('id', id).maybeSingle();
  const empresa = linhas<EmpresaRow>(data ? [data] : [])[0];
  if (!empresa) notFound();
  const abas = [['diagnostico', 'Diagnóstico'], ['colaboradores', 'Colaboradores'], ['importar', 'Importar planilha']] as const;
  return (
    <>
      <div>
        <Link href="/empresas" className="text-sm text-blue-800 hover:underline dark:text-blue-300">← Empresas</Link>
        <h1 className="text-2xl font-bold">{empresa.razao_social}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">CNPJ {formatarCnpj(empresa.cnpj)}</p>
      </div>
      <nav aria-label="Seções da empresa" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {abas.map(([slug, rotulo]) => (
          <Link key={slug} href={`/empresas/${id}/${slug}`} className="rounded-t px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800">{rotulo}</Link>
        ))}
      </nav>
      {children}
    </>
  );
}
