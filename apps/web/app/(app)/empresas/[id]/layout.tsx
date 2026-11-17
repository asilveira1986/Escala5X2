import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import type { EmpresaRow } from '@/lib/tipos-db';

export default async function EmpresaLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const id = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const { data } = await supabase.from('empresa').select('id').eq('id', id).maybeSingle();
  const empresa = linhas<EmpresaRow>(data ? [data] : [])[0];
  if (!empresa) notFound();
  return (
    <>
      {children}
    </>
  );
}
