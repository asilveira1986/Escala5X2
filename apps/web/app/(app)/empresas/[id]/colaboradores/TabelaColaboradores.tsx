'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Gaveta } from '@/components/Gaveta';
import { TabelaDados } from '@/components/TabelaDados';
import { classeBotaoLinkPrimario, Selo } from '@/components/ui';
import { decimal, horasMin, moeda, moedaHora } from '@jc/documents/formatar';
import type { LinhaEquipe } from '@/lib/tipos-db';
import { CelulaAcesso } from './CelulaAcesso';

type Estado = LinhaEquipe['acesso']['estado'];
const STATUS: Record<Estado, { rotulo: string; tom: 'verde' | 'amarelo' | 'cinza' }> = {
  com: { rotulo: 'Com acesso', tom: 'verde' },
  pendente: { rotulo: 'Convite enviado', tom: 'amarelo' },
  sem: { rotulo: 'Sem acesso', tom: 'cinza' },
};
const vazio = (v: string | null | undefined) => (v && v.trim() ? v : '—');

/** Na lista só o essencial (nome, setor e status); cargo e escala ficam ocultos, mas entram na busca. O resto abre no painel ao clicar na linha. */
const colunas: ColumnDef<LinhaEquipe, unknown>[] = [
  { accessorKey: 'nome', header: 'Nome', cell: (c) => <button type="button" className="text-left font-semibold hover:underline">{c.getValue() as string}</button> },
  { accessorKey: 'setor_nome', header: 'Setor', cell: (c) => vazio(c.getValue() as string | null) },
  { id: 'status', accessorFn: (r) => STATUS[r.acesso.estado].rotulo, header: 'Status', enableSorting: false, cell: (c) => <Selo tom={STATUS[c.row.original.acesso.estado].tom}>{c.getValue() as string}</Selo> },
  { accessorKey: 'cargo', header: 'Cargo' },
  { accessorKey: 'tipo_escala', header: 'Escala' },
  { accessorKey: 'matricula', header: 'Matrícula' },
];
const OCULTAS = ['cargo', 'tipo_escala', 'matricula'];

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <div><dt className="rotulo-col">{rotulo}</dt><dd className="mt-0.5 text-sm font-medium">{children}</dd></div>;
}

export function TabelaColaboradores({ dados, empresaId, podeGerir }: { dados: LinhaEquipe[]; empresaId: string; podeGerir: boolean }) {
  // guarda só o id: depois de convidar ou remover o acesso, a lista é recarregada e o painel mostra o estado novo
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const c = dados.find((d) => d.colaborador_id === escolhido) ?? null;
  const porHora = c ? Math.round((Number(c.salario_base) / c.divisor) * 100) : 0;
  return (
    <>
      <TabelaDados colunas={colunas} dados={dados} colunasOcultas={OCULTAS} aoClicarLinha={(l) => setEscolhido(l.colaborador_id)}
        rotuloBusca="Buscar colaborador" vazio="Nenhum colaborador com contrato vigente. Importe uma planilha." />
      <Gaveta aberta={!!c} onFechar={() => setEscolhido(null)} titulo={c?.nome ?? ''}
        subtitulo={c ? [c.cargo, c.setor_nome].filter(Boolean).join(' · ') || '—' : undefined}
        rodape={c && podeGerir ? <Link href={`/empresas/${empresaId}/colaboradores/${c.colaborador_id}`} className={classeBotaoLinkPrimario}>Editar cadastro</Link> : undefined}>
        {c ? (
          <>
            <section aria-label="Contrato e escala">
              <h3 className="mb-2 text-[15px] font-bold">Contrato e escala</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Dado rotulo="Escala">{c.tipo_escala}</Dado>
                <Dado rotulo="Jornada semanal">{horasMin(c.jornada_semanal_min)}</Dado>
                <Dado rotulo="Turno">{vazio(c.turno)}</Dado>
                <Dado rotulo="Matrícula">{vazio(c.matricula)}</Dado>
                <Dado rotulo="Salário"><span className="horario">{moeda(Math.round(Number(c.salario_base) * 100))}</span></Dado>
                <Dado rotulo="Valor/hora"><span className="horario">{moedaHora(porHora)}</span></Dado>
                <Dado rotulo="Divisor"><span className="horario">{decimal(c.divisor, 0)}</span></Dado>
                {c.hipersuficiente ? <Dado rotulo="Perfil"><Selo tom="azul">Alta renda</Selo></Dado> : null}
              </dl>
            </section>
            <section aria-label="Acesso ao app">
              <h3 className="mb-2 text-[15px] font-bold">Acesso ao app</h3>
              <CelulaAcesso empresaId={empresaId} colaboradorId={c.colaborador_id} nome={c.nome} acesso={c.acesso} podeGerir={podeGerir} />
            </section>
          </>
        ) : null}
      </Gaveta>
    </>
  );
}
