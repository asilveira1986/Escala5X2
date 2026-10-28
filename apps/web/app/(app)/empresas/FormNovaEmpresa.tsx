'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { ROTULO_PORTE, type OrganizacaoRow } from '@/lib/tipos-db';
import { criarEmpresa, type EstadoCriarEmpresa } from './actions';

export function FormNovaEmpresa({ organizacoes }: { organizacoes: Pick<OrganizacaoRow, 'id' | 'nome'>[] }) {
  const [estado, acao, pendente] = useActionState<EstadoCriarEmpresa, FormData>(criarEmpresa, {});
  const erro = (c: string) => (estado.erros?.[c] ? <span role="alert" className="mt-1 block text-xs text-red-700 dark:text-red-300">{estado.erros[c]}</span> : null);
  return (
    <form action={acao} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Campo rotulo="Organização dona do dado">
        <select name="organizacaoId" required className={classeCampo} defaultValue={organizacoes[0]?.id}>
          {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
        {erro('organizacaoId')}
      </Campo>
      <Campo rotulo="Razão social"><input name="razaoSocial" required className={classeCampo} />{erro('razaoSocial')}</Campo>
      <Campo rotulo="CNPJ"><input name="cnpj" required inputMode="numeric" placeholder="00.000.000/0000-00" className={classeCampo} />{erro('cnpj')}</Campo>
      <Campo rotulo="Porte">
        <select name="porte" className={classeCampo} defaultValue="medio">
          {Object.entries(ROTULO_PORTE).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Município (código IBGE)" dica="7 dígitos, ex.: 3550308 (São Paulo)"><input name="municipioIbge" required inputMode="numeric" maxLength={7} className={classeCampo} />{erro('municipioIbge')}</Campo>
      <Campo rotulo="UF"><input name="uf" required maxLength={2} className={`${classeCampo} uppercase`} />{erro('uf')}</Campo>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="terceirizadaPublica" /> Empresa terceirizada da administração pública (prazo de 12 meses para eliminar a escala 6x1)
      </label>
      <div className="sm:col-span-2">
        {estado.erroGeral ? <Aviso tipo="erro">{estado.erroGeral}</Aviso> : null}
        <Botao disabled={pendente} className="mt-2">{pendente ? 'Criando…' : 'Criar empresa'}</Botao>
      </div>
    </form>
  );
}
