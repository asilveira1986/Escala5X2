'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { criarOrganizacao, type EstadoOrganizacao } from './organizacao-actions';

const opcoes = [
  ['empresa', 'Sou uma empresa', 'Quero adequar a minha própria equipe à escala 5x2.'],
  ['contabilidade', 'Sou um escritório de contabilidade', 'Atendo várias empresas e quero acompanhar a carteira.'],
  ['juridico', 'Sou um escritório de advocacia', 'Cuido de acordos coletivos e da defesa de clientes.'],
] as const;

export function FormNovaOrganizacao() {
  const [estado, acao, pendente] = useActionState<EstadoOrganizacao, FormData>(criarOrganizacao, {});
  const erro = (c: string) => (estado.erros?.[c] ? <span role="alert" className="mt-1 block text-xs text-risco-fg">{estado.erros[c]}</span> : null);
  return (
    <form action={acao} className="space-y-4" noValidate>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Como você vai usar o JornadaCerta?</legend>
        {opcoes.map(([valor, rotulo, dica], i) => (
          <label key={valor} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-linha p-3 has-[:checked]:border-marca has-[:checked]:bg-marca-suave">
            <input type="radio" name="tipo" value={valor} defaultChecked={i === 0} className="mt-1 accent-[var(--c-marca)]" />
            <span><span className="block text-sm font-semibold">{rotulo}</span><span className="block text-xs text-suave">{dica}</span></span>
          </label>
        ))}
        {erro('tipo')}
      </fieldset>
      <Campo rotulo="Nome da organização" dica="Pode ser o nome fantasia. Você poderá cadastrar as empresas em seguida.">
        <input name="nome" required maxLength={120} autoComplete="organization" className={classeCampo} />
        {erro('nome')}
      </Campo>
      {estado.erroGeral ? <Aviso tipo="erro">{estado.erroGeral}</Aviso> : null}
      <Botao disabled={pendente}>{pendente ? 'Criando…' : 'Criar e continuar'}</Botao>
    </form>
  );
}
