'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
    <>
      <h1>{cadastro ? 'Ativar verificação em duas etapas' : 'Verificação em duas etapas'}</h1>
      {cadastro && qr && (
        <>
          <p>Escaneie o QR code no seu aplicativo autenticador e digite o código gerado.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code do autenticador" width={200} height={200} />
        </>
      )}
      <form onSubmit={verificar}>
        <label>Código de 6 dígitos <input value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" required /></label>
        <button>Confirmar</button>
        {erro && <p role="alert">{erro}</p>}
      </form>
    </>
  );
}
