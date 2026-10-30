'use client';

import { useActionState } from 'react';
import { supabaseNavegador } from '@/lib/supabase/client';
import { entrarComSenha, enviarLinkMagico, type EstadoLogin } from './actions';

export default function Login() {
  const [senha, acaoSenha, pendenteSenha] = useActionState<EstadoLogin, FormData>(entrarComSenha, {});
  const [link, acaoLink, pendenteLink] = useActionState<EstadoLogin, FormData>(enviarLinkMagico, {});

  async function google() {
    await supabaseNavegador().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  return (
    <>
      <h1>Entrar</h1>
      <form action={acaoSenha}>
        <label>E-mail <input name="email" type="email" required autoComplete="email" /></label><br />
        <label>Senha <input name="senha" type="password" required minLength={8} autoComplete="current-password" /></label><br />
        <button disabled={pendenteSenha}>Entrar</button>
        {senha.erro && <p role="alert">{senha.erro}</p>}
      </form>
      <hr />
      <form action={acaoLink}>
        <label>E-mail para link mágico <input name="email" type="email" required /></label>
        <button disabled={pendenteLink}>Enviar link</button>
        {link.enviado && <p>Link enviado. Verifique seu e-mail.</p>}
        {link.erro && <p role="alert">{link.erro}</p>}
      </form>
      <hr />
      <button onClick={google}>Entrar com Google</button>
    </>
  );
}
