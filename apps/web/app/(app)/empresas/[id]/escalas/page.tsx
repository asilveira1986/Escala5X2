import Link from 'next/link';
import { EstadoVazio } from '@/components/EstadoVazio';
import { Cartao, classeBotaoLink, Selo } from '@/components/ui';
import { exigirUsuario, idOu404, linhas } from '@/lib/contexto';
import { dataBr, dataDeInstante, duracao, hhmm } from '@jc/rules-engine';
import { FormModeloTurno } from './FormModeloTurno';
import { FormNovaEscala } from './FormNovaEscala';

type EscalaLinha = { id: string; nome: string; periodo: string; status: 'rascunho' | 'publicada' | 'substituida'; versao: number; publicada_em: string | null };
type ModeloLinha = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number; cor: string };
const tom = { rascunho: 'amarelo', publicada: 'verde', substituida: 'cinza' } as const;
const rotulo = { rascunho: 'Rascunho', publicada: 'Publicada', substituida: 'Substituída' } as const;

/** "[2027-02-01,2027-03-01)" → "01/02/2027 a 28/02/2027" */
function periodoLegivel(p: string): string {
  const m = /^[\[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})[\])]$/.exec(p);
  if (!m) return p;
  const fim = new Date(Date.parse(`${m[2]}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${dataBr(m[1]!)} a ${dataBr(fim)}`;
}

export default async function Escalas({ params }: { params: Promise<{ id: string }> }) {
  const empresaId = idOu404((await params).id);
  const { supabase } = await exigirUsuario();
  const [esc, mod, set] = await Promise.all([
    supabase.from('escala').select('id, nome, periodo, status, versao, publicada_em').eq('empresa_id', empresaId).order('periodo', { ascending: false }).order('versao', { ascending: false }).limit(50),
    supabase.from('turno_modelo').select('id, nome, inicio_min, fim_min, intervalo_min, cor').eq('empresa_id', empresaId).eq('ativo', true).order('inicio_min'),
    supabase.from('setor').select('id, nome, unidade!inner(empresa_id)').eq('unidade.empresa_id', empresaId).order('nome'),
  ]);
  const escalas = linhas<EscalaLinha>(esc.data), modelos = linhas<ModeloLinha>(mod.data);
  const setores = linhas<{ id: string; nome: string }>(set.data).map((s) => ({ id: s.id, nome: s.nome }));
  const hoje = dataDeInstante(new Date());
  return (
    <>
      <Cartao titulo="Nova escala" subtitulo="Monte o mês, veja os avisos da lei na hora e publique quando estiver tudo certo.">
        {modelos.length === 0 ? <p className="mb-3 rounded-2xl bg-atencao-bg px-3.5 py-2 text-sm font-medium text-atencao-fg">Cadastre pelo menos um turno abaixo para poder montar a escala.</p> : null}
        <FormNovaEscala empresaId={empresaId} mesPadrao={hoje.slice(0, 7)} setores={setores} />
      </Cartao>
      <div className="flex flex-wrap gap-2">
        <Link href={`/empresas/${empresaId}/escalas/cobertura`} className={classeBotaoLink}>Cobertura mínima</Link>
        <Link href={`/empresas/${empresaId}/escalas/ausencias`} className={classeBotaoLink}>Férias e afastamentos</Link>
        <Link href={`/empresas/${empresaId}/banco-horas`} className={classeBotaoLink}>Banco de horas</Link>
        <Link href={`/empresas/${empresaId}/folha`} className={classeBotaoLink}>Fechamento para a folha</Link>
      </div>
      <Cartao titulo="Escalas">
        {escalas.length === 0 ? <EstadoVazio titulo="Nenhuma escala ainda">Crie a primeira acima. Os turnos que você cadastrar ficam disponíveis para pintar na grade.</EstadoVazio> : (
          <ul className="divide-y divide-linha">
            {escalas.map((e) => (
              <li key={e.id}>
                <Link href={`/empresas/${empresaId}/escalas/${e.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-1.5 hover:text-marca">
                  <span className="font-semibold">{e.nome} <span className="font-normal text-suave">· versão {e.versao}</span></span>
                  <span className="flex items-center gap-3 text-sm text-suave">{periodoLegivel(e.periodo)}<Selo tom={tom[e.status]}>{rotulo[e.status]}</Selo></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
      <Cartao titulo="Turnos" subtitulo="Modelos de horário para pintar na grade.">
        {modelos.length > 0 ? (
          <ul className="mb-4 flex flex-wrap gap-2">
            {modelos.map((m) => (
              <li key={m.id} className="rounded-full border border-linha bg-fundo px-3 py-1 text-sm">
                <span className="font-semibold">{m.nome}</span> {hhmm(m.inicio_min)}–{hhmm(m.fim_min)}
                <span className="text-suave"> · {duracao(m.fim_min - m.inicio_min - m.intervalo_min)} líquidas</span>
              </li>
            ))}
          </ul>
        ) : null}
        <FormModeloTurno empresaId={empresaId} />
      </Cartao>
    </>
  );
}
