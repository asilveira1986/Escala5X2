import Link from 'next/link';
import { Cartao, Selo } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { ROTULO_PORTE, ROTULO_STATUS, type EmpresaRow, type OrganizacaoRow } from '@/lib/tipos-db';
import { formatarCnpj } from '@jc/connectors';
import { FormNovaEmpresa } from './FormNovaEmpresa';

const tom = { nao_iniciado: 'cinza', em_risco: 'amarelo', adequado: 'verde' } as const;

export default async function Empresas() {
  const { supabase } = await exigirUsuario();
  const [{ data: emp }, { data: orgs }] = await Promise.all([
    supabase.from('empresa').select('id, razao_social, cnpj, porte, uf, status_adequacao').order('razao_social'),
    supabase.from('organizacao').select('id, nome, tipo').neq('tipo', 'plataforma').order('nome'),
  ]);
  const empresas = linhas<EmpresaRow>(emp);
  const organizacoes = linhas<OrganizacaoRow>(orgs);
  return (
    <>
      <h1 className="text-2xl font-bold">Empresas</h1>
      <Cartao>
        {empresas.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Nenhuma empresa cadastrada. Crie a primeira abaixo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-600 dark:border-slate-800 dark:text-slate-400">
                <tr><th className="py-2 pr-3">Razão social</th><th className="pr-3">CNPJ</th><th className="pr-3">Porte</th><th className="pr-3">UF</th><th>Adequação</th></tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-3"><Link className="font-medium text-blue-800 hover:underline dark:text-blue-300" href={`/empresas/${e.id}/diagnostico`}>{e.razao_social}</Link></td>
                    <td className="pr-3">{formatarCnpj(e.cnpj)}</td>
                    <td className="pr-3">{ROTULO_PORTE[e.porte]}</td>
                    <td className="pr-3">{e.uf}</td>
                    <td><Selo tom={tom[e.status_adequacao]}>{ROTULO_STATUS[e.status_adequacao]}</Selo></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
      {organizacoes.length > 0 && <Cartao titulo="Nova empresa"><FormNovaEmpresa organizacoes={organizacoes} /></Cartao>}
    </>
  );
}
