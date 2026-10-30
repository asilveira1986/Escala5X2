'use client';

import { useActionState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { supabaseNavegador } from '@/lib/supabase/client';
import { entrarComSenha, enviarLinkMagico, type EstadoLogin } from './actions';

export default function Login() {
  const [senha, acaoSenha, pendenteSenha] = useActionState<EstadoLogin, FormData>(entrarComSenha, {});
  const [link, acaoLink, pendenteLink] = useActionState<EstadoLogin, FormData>(enviarLinkMagico, {});

  async function google() {
    await supabaseNavegador().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/auth/callback` } });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Entrar</h1>
        <p className="mt-1 text-suave">Use seu e-mail e senha, ou peça um link de acesso.</p>
      </div>
      <form action={acaoSenha} className="space-y-4">
        <Campo rotulo="E-mail"><input name="email" type="email" required autoComplete="email" className={classeCampo} /></Campo>
        <Campo rotulo="Senha"><input name="senha" type="password" required minLength={8} autoComplete="current-password" className={classeCampo} /></Campo>
        {senha.erro ? <Aviso tipo="erro">{senha.erro}</Aviso> : null}
        <Botao className="w-full" disabled={pendenteSenha}>{pendenteSenha ? 'Entrando…' : 'Entrar'}</Botao>
      </form>

      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-suave"><span className="h-px flex-1 bg-linha" />ou<span className="h-px flex-1 bg-linha" /></div>

      <form action={acaoLink} className="space-y-3">
        <Campo rotulo="Receber link de acesso por e-mail"><input name="email" type="email" required className={classeCampo} placeholder="voce@empresa.com.br" /></Campo>
        {link.enviado ? <Aviso tipo="ok">Link enviado. Confira sua caixa de entrada.</Aviso> : null}
        {link.erro ? <Aviso tipo="erro">{link.erro}</Aviso> : null}
        <Botao variante="secundario" className="w-full" disabled={pendenteLink}>Enviar link</Botao>
      </form>
      <Botao variante="secundario" className="w-full" type="button" onClick={google}>Entrar com Google</Botao>
    </div>
  );
}
