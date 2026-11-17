import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Casca } from '@/components/Casca';
import { PwaRegistro } from '@/components/PwaRegistro';
import { cobrancaAtiva } from '@/lib/cobranca';
import { exigirUsuario, linhas } from '@/lib/contexto';
import { dataDeInstante } from '@jc/rules-engine';
import { situacaoDaConta, type StatusAssinatura } from '@jc/servicos';
import { COOKIE_MENU, lerEstadoMenu } from '@/lib/menu';
import { hashUsuario } from '@/lib/pwa/uid';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, user } = await exigirUsuario();
  // Aviso visível enquanto o MFA estiver desligado (erro na consulta = considera ligado, sem aviso falso).
  const { data: mfaObrigatorio } = await supabase.rpc('mfa_obrigatorio');
  const { data: gestao } = await supabase.rpc('minhas_organizacoes_gestao');
  const ehGestor = Array.isArray(gestao) && gestao.length > 0;
  const [{ count }, { data: emp }, { count: naoLidas }, { data: assin }] = await Promise.all([
    supabase.from('colaborador').select('id', { count: 'exact', head: true }).eq('usuario_id', user.id),
    // empresas do seletor do menu (só para quem gere; o RLS já limita ao que a pessoa pode ver)
    ehGestor ? supabase.from('empresa').select('id, razao_social').order('razao_social').limit(300) : Promise.resolve({ data: [] }),
    supabase.from('notificacao').select('id', { count: 'exact', head: true }).is('lida_em', null),
    // sem a tabela ainda (SQL não aplicado) a consulta só devolve erro: nada é bloqueado nem avisado
    supabase.from('assinatura').select('status, teste_ate, proximo_vencimento'),
  ]);
  // cobrança: só a gestão vê o aviso e é bloqueada; quem só consulta a própria escala não perde acesso por conta da empresa
  const hoje = dataDeInstante(new Date());
  const situacoes = ehGestor ? linhas<{ status: StatusAssinatura; teste_ate: string | null; proximo_vencimento: string | null }>(assin).map((a) => situacaoDaConta({ status: a.status, testeAte: a.teste_ate, hoje, vencidaDesde: a.proximo_vencimento, cobrancaAtiva: cobrancaAtiva() })) : [];
  const peso = { risco: 3, atencao: 2, info: 1 } as const;
  const aviso = situacoes.map((s) => s.aviso).filter((a): a is NonNullable<typeof a> => !!a).sort((x, y) => peso[y.tom] - peso[x.tom])[0] ?? null;
  const cobranca = { aviso, bloqueado: situacoes.length > 0 && situacoes.every((s) => s.bloqueado) };
  const jar = await cookies();
  return (
    <Casca email={user.email ?? ''} mfaDesligado={mfaObrigatorio === false} temMinhaEscala={(count ?? 0) > 0} temCarteira={ehGestor} ehGestor={ehGestor} naoLidas={naoLidas ?? 0} cobranca={cobranca}
      empresas={linhas<{ id: string; razao_social: string }>(emp).map((e) => ({ id: e.id, nome: e.razao_social }))} estadoMenu={lerEstadoMenu(jar.get(COOKIE_MENU)?.value)}>
      {children}
      <PwaRegistro usuario={await hashUsuario(user.id)} />
    </Casca>
  );
}
