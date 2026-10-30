'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { supabaseNavegador } from '@/lib/supabase/client';

export default function PaginaMfa() {
  return <Suspense><Mfa /></Suspense>;
}

function Mfa() {
  const router = useRouter();
  const cadastro = useSearchParams().get('etapa') === 'cadastro';
  const [fatorId, setFatorId] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string>();

  useEffect(() => {
    const supabase = supabaseNavegador();
    (async () => {
      if (cadastro) {
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Aplicativo autenticador' });
        if (error) return setErro('Não foi possível iniciar o cadastro do autenticador.');
        setFatorId(data.id);
        setQr(data.totp.qr_code);
      } else {
        const { data } = await supabase.auth.mfa.listFactors();
        setFatorId(data?.totp[0]?.id);
      }
    })();
  }, [cadastro]);

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    if (!fatorId) return;
    const supabase = supabaseNavegador();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo });
    if (error) return setErro('Código inválido. Tente novamente.');
    router.replace('/');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">{cadastro ? 'Proteja sua conta' : 'Confirme que é você'}</h1>
        <p className="mt-1 text-suave">{cadastro ? 'Seu perfil acessa dados de folha e exige verificação em duas etapas. Leva um minuto.' : 'Digite o código de 6 dígitos do seu aplicativo autenticador.'}</p>
      </div>
      {cadastro && qr && (
        <div className="rounded-2xl border border-linha bg-cartao p-4">
          <p className="mb-3 text-sm font-semibold">1. Abra um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy) e escaneie:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code do autenticador" width={180} height={180} className="mx-auto rounded-lg bg-white p-2" />
          <p className="mt-3 text-sm font-semibold">2. Digite o código que aparecer:</p>
        </div>
      )}
      <form onSubmit={verificar} className="space-y-4">
        <Campo rotulo="Código de 6 dígitos"><input id="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className={`${classeCampo} text-center text-2xl tracking-[0.4em]`} /></Campo>
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
        <Botao className="w-full">Confirmar</Botao>
      </form>
    </div>
  );
}
