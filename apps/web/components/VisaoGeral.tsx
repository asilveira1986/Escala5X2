import Link from 'next/link';
import { IconeCheck, IconeSeta } from '@/components/icones';
import { Cartao, IconeCaixa, Metrica, Selo } from '@/components/ui';
import { montarMenu } from '@/lib/menu';
import { ROTULO_STATUS, type EmpresaRow } from '@/lib/tipos-db';
import { formatarCnpj } from '@jc/connectors/parsers';

const tom = { nao_iniciado: 'cinza', em_risco: 'amarelo', adequado: 'verde' } as const;
export type ResumoEmpresa = { colab: number; turnos: number; publicadas: number; rascunhos: number; pendentes: number };

/** Visão geral da empresa: identificação, números, primeiros passos e as áreas do sistema (vindas do menu). */
export function VisaoGeral({ empresaId, empresa, resumo }: { empresaId: string; empresa: Pick<EmpresaRow, 'razao_social' | 'cnpj' | 'status_adequacao'>; resumo: ResumoEmpresa }) {
  const { colab, turnos, publicadas, rascunhos, pendentes } = resumo;
  const base = `/empresas/${empresaId}`;
  const passos = [
    { ok: colab > 0, texto: 'Cadastrar os colaboradores', dica: 'Um a um ou por planilha', href: `${base}/colaboradores` },
    { ok: turnos > 0, texto: 'Cadastrar os turnos', dica: 'Modelos de horário da empresa', href: `${base}/escalas/turnos` },
    { ok: publicadas > 0, texto: 'Montar e publicar a primeira escala', dica: 'Com a conferência da lei na hora', href: `${base}/escalas` },
  ];
  const feitos = passos.filter((p) => p.ok).length;
  // as áreas vêm do próprio menu: um só lugar define o que existe, o nome e o ícone
  const grupos = montarMenu({ empresaId, ehGestor: true, temMinhaEscala: false, temCarteira: false }).find((s) => s.id === 'empresa')!.grupos.filter((g) => g.id !== 'visao');
  // grupos com subitens viram um cartão cada; os links diretos (Diagnóstico, Pedidos) ficam juntos em "Acompanhamento"
  const diretos = grupos.filter((g) => !g.itens).map((g) => ({ id: g.id, rotulo: g.rotulo, href: g.href!, icone: g.icone, descricao: g.descricao }));
  const blocos = [
    ...grupos.filter((g) => g.itens).map((g) => ({ id: g.id, titulo: g.rotulo, icone: g.icone, itens: g.itens! })),
    { id: 'acompanhamento', titulo: 'Acompanhamento', icone: 'diagnostico' as const, itens: diretos },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl border border-linha bg-cartao p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)] sm:p-6">
        <IconeCaixa icone="empresas" tamanho="lg" />
        <div className="min-w-0 flex-1 basis-40">
          <h1 className="text-xl font-bold leading-tight tracking-tight sm:text-2xl" title={empresa.razao_social}>{empresa.razao_social}</h1>
          <p className="text-sm text-suave">CNPJ {formatarCnpj(empresa.cnpj)}</p>
        </div>
        <Selo tom={tom[empresa.status_adequacao]}>{ROTULO_STATUS[empresa.status_adequacao]}</Selo>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metrica href={`${base}/colaboradores`} icone="pessoas" rotulo="Colaboradores ativos" valor={colab} texto="Ver e cadastrar equipe" />
        <Metrica href={`${base}/escalas`} icone="calendario" rotulo="Escalas publicadas" valor={publicadas} tom="ok" texto={rascunhos > 0 ? `${rascunhos} em rascunho` : 'Montar o mês'} />
        <Metrica href={`${base}/solicitacoes`} icone="pedidos" rotulo="Pedidos para decidir" valor={pendentes} tom={pendentes > 0 ? 'atencao' : 'neutro'} texto={pendentes > 0 ? 'Há pedidos esperando' : 'Nada pendente'} />
        <Metrica href={`${base}/escalas/turnos`} icone="turnos" rotulo="Turnos" valor={turnos} tom="neutro" texto="Modelos de horário" />
      </div>

      {feitos < passos.length ? (
        <Cartao titulo="Primeiros passos" subtitulo={`${feitos} de ${passos.length} concluídos — o caminho mais curto até a escala publicada.`} icone="inicio">
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-neutro-bg" role="progressbar" aria-valuenow={feitos} aria-valuemin={0} aria-valuemax={passos.length} aria-label="Progresso dos primeiros passos">
            <div className="h-full rounded-full bg-marca transition-all" style={{ width: `${(feitos / passos.length) * 100}%` }} />
          </div>
          <ol className="grid gap-2 md:grid-cols-3">
            {passos.map((p, i) => (
              <li key={p.href}>
                <Link href={p.href} className={`flex h-full items-center gap-3 rounded-2xl border p-3 transition-colors hover:border-marca ${p.ok ? 'border-ok-bg bg-ok-bg/40' : 'border-linha'}`}>
                  <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${p.ok ? 'bg-ok-fg text-ok-bg' : 'bg-marca-suave text-marca'}`}>{p.ok ? <IconeCheck width={16} height={16} strokeWidth={3} /> : i + 1}</span>
                  <span className="min-w-0"><span className={`block text-sm font-semibold ${p.ok ? 'text-suave line-through' : ''}`}>{p.texto}</span><span className="block text-xs text-suave">{p.dica}</span></span>
                </Link>
              </li>
            ))}
          </ol>
        </Cartao>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {blocos.map(({ id, titulo, icone, itens }) => {
          return (
            <Cartao key={id} titulo={titulo} icone={icone}>
              <ul className="-mx-2 space-y-0.5">
                {itens.map((i) => (
                  <li key={i.id}>
                    <Link href={i.href} className="group flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-fundo">
                      <IconeCaixa icone={i.icone} tom="neutro" tamanho="sm" />
                      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{i.rotulo}</span>{i.descricao ? <span className="block text-xs text-suave">{i.descricao}</span> : null}</span>
                      <IconeSeta width={16} height={16} className="shrink-0 text-suave transition-transform group-hover:translate-x-0.5 group-hover:text-marca" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Cartao>
          );
        })}
      </div>
    </>
  );
}
