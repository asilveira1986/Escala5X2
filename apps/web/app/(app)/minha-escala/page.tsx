import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Aviso, Cartao } from '@/components/ui';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { agruparPorEscala, proximoTurno, textoTurno, type LinhaMinhaEscala } from '@/lib/minha-escala';
import { dataBr, diaDaSemana } from '@jc/rules-engine';
import { BlocoEscala } from './BlocoEscala';

const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Hora de São Paulo (o servidor roda em UTC), em minutos desde 00:00. */
function agoraEmMinutos(): { hoje: string; min: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return { hoje: `${v('year')}-${v('month')}-${v('day')}`, min: Number(v('hour')) * 60 + Number(v('minute')) };
}

export default async function MinhaEscala() {
  const { supabase, user } = await exigirUsuario();
  // O RLS deixa gestores e líderes verem mais gente; esta tela é sempre só da própria pessoa.
  const { data: colabs } = await supabase.from('colaborador').select('id, nome').eq('usuario_id', user.id);
  const meus = linhas<{ id: string; nome: string }>(colabs);
  const [{ data: aloc }, { data: ciencias }] = meus.length === 0 ? [{ data: [] }, { data: [] }] : await Promise.all([
    supabase.from('alocacao')
      .select('escala_id, data, tipo, inicio_min, fim_min, intervalo_min, escala!inner(id, nome, periodo, versao, publicada_em, hash_publicado, status)')
      .in('colaborador_id', meus.map((c) => c.id)).eq('escala.status', 'publicada').order('data'),
    supabase.from('ciencia').select('escala_id, ciente_em').eq('usuario_id', user.id),
  ]);
  const nome = meus[0]?.nome;
  const escalas = agruparPorEscala(linhas<LinhaMinhaEscala>(aloc), linhas<{ escala_id: string; ciente_em: string }>(ciencias));
  const { hoje, min } = agoraEmMinutos();
  const proximo = proximoTurno(escalas, hoje, min);
  const pendentes = escalas.filter((e) => !e.cienteEm);

  if (!nome) {
    return <EstadoVazio titulo="Seu cadastro ainda não está ligado a uma escala">Peça ao RH para vincular o seu acesso ao seu cadastro de colaborador.</EstadoVazio>;
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">Minha escala</h1>
        <p className="mt-1 text-suave">Olá, {nome.split(' ')[0]}. Aqui estão os seus horários publicados.</p>
      </div>

      <Link href="/minha-escala/pedidos" className="inline-flex min-h-11 items-center rounded-full border border-linha bg-cartao px-4 text-sm font-semibold text-marca hover:bg-marca-suave sm:min-h-9">Pedir troca, folga ou férias</Link>

      {pendentes.length > 0 ? <Aviso tipo="info">{pendentes.length === 1 ? 'Há uma escala aguardando a sua ciência.' : `Há ${pendentes.length} escalas aguardando a sua ciência.`} Leia e confirme abaixo.</Aviso> : null}

      {proximo ? (
        <Cartao titulo="Seu próximo turno">
          <p className="text-xl font-bold">{proximo.dia.data === hoje ? 'Hoje' : `${DIAS_LONGOS[diaDaSemana(proximo.dia.data)]}, ${dataBr(proximo.dia.data)}`}</p>
          <p className="text-suave">{textoTurno(proximo.dia)}</p>
        </Cartao>
      ) : null}

      {escalas.length === 0 ? (
        <Cartao><EstadoVazio titulo="Nenhuma escala publicada para você">Quando o RH publicar a sua escala, ela aparece aqui.</EstadoVazio></Cartao>
      ) : escalas.map((e) => <BlocoEscala key={e.id} e={e} hoje={hoje} />)}
    </>
  );
}
