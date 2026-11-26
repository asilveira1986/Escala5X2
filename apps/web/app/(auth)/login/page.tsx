'use client';

import { useActionState, useState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { supabaseNavegador } from '@/lib/supabase/client';
import { entrarComSenha, enviarLinkMagico, type EstadoLogin } from './actions';

export default function Login() {
  const [senha, acaoSenha, pendenteSenha] = useActionState<EstadoLogin, FormData>(entrarComSenha, {});
  const [link, acaoLink, pendenteLink] = useActionState<EstadoLogin, FormData>(enviarLinkMagico, {});
  const [verSenha, setVerSenha] = useState(false);
  const [erroGoogle, setErroGoogle] = useState<string | null>(null);

  async function google() {
    setErroGoogle(null);
    const { error } = await supabaseNavegador().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/auth/callback` } });
    if (error) setErroGoogle('Não foi possível entrar com o Google agora. Tente de novo ou use e-mail e senha.');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Entrar</h1>
        <p className="mt-1 text-suave">Bem-vindo de volta. Use seu e-mail e senha para acessar a sua escala.</p>
      </div>

      <form action={acaoSenha} className="space-y-4" aria-label="Entrar com e-mail e senha">
        <Campo rotulo="E-mail"><input name="email" type="email" required autoFocus autoComplete="username" placeholder="voce@empresa.com.br" className={classeCampo} /></Campo>
        <div>
          <label htmlFor="senha" className="block text-sm font-semibold">Senha</label>
          <span className="relative mt-1 block">
            <input id="senha" name="senha" type={verSenha ? 'text' : 'password'} required minLength={8} autoComplete="current-password" className={`${classeCampo} !mt-0 pr-20`} />
            <button type="button" onClick={() => setVerSenha((v) => !v)} aria-pressed={verSenha}
              className="absolute inset-y-0 right-1 my-auto h-8 rounded-md px-2.5 text-xs font-semibold text-marca hover:bg-marca-suave">{verSenha ? 'Ocultar' : 'Mostrar'}</button>
          </span>
        </div>
        {senha.erro ? <Aviso tipo="erro">{senha.erro}</Aviso> : null}
        <Botao className="w-full" disabled={pendenteSenha}>{pendenteSenha ? 'Entrando…' : 'Entrar'}</Botao>
      </form>

      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-suave"><span className="h-px flex-1 bg-linha" />ou<span className="h-px flex-1 bg-linha" /></div>

      <div className="space-y-3">
        <Botao variante="secundario" className="w-full" type="button" onClick={google}>Entrar com Google</Botao>
        {erroGoogle ? <Aviso tipo="erro">{erroGoogle}</Aviso> : null}

        <details className="group rounded-2xl border border-linha bg-cartao" open={!!link.enviado || !!link.erro}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-sm font-semibold text-marca">
            Prefiro receber um link de acesso por e-mail
            <span aria-hidden className="text-suave transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <form action={acaoLink} className="space-y-3 border-t border-linha p-3.5" aria-label="Receber link de acesso por e-mail">
            <Campo rotulo="E-mail para receber o link" dica="Sem senha: você clica no link que chegar na caixa de entrada."><input name="email" type="email" required className={classeCampo} placeholder="voce@empresa.com.br" /></Campo>
            {link.enviado ? <Aviso tipo="ok">Link enviado. Confira sua caixa de entrada.</Aviso> : null}
            {link.erro ? <Aviso tipo="erro">{link.erro}</Aviso> : null}
            <Botao variante="secundario" className="w-full" disabled={pendenteLink}>{pendenteLink ? 'Enviando…' : 'Enviar link'}</Botao>
          </form>
        </details>
      </div>

      <p className="text-center text-xs text-suave">Seus dados de jornada são protegidos e só aparecem para quem tem permissão na empresa.</p>
    </div>
  );
}
