import Link from 'next/link';
import { Abas } from '@/components/Abas';
import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { Aviso, Cartao, Selo } from '@/components/ui';
import { minutosParaHoras, reaisParaTexto } from '@/lib/colaborador-form';
import { horasMin, moeda, moedaHora } from '@jc/documents/formatar';
import { dataBr } from '@jc/rules-engine';
import { CelulaAcesso, type Acesso } from '../CelulaAcesso';
import { FormEditarPessoa } from './FormEditarPessoa';
import { FormMudarContrato } from './FormMudarContrato';
import { PainelDesligamento } from './PainelDesligamento';

export const ABAS = [{ id: 'dados', rotulo: 'Dados pessoais' }, { id: 'contrato', rotulo: 'Contrato e escala' }, { id: 'acesso', rotulo: 'Acesso ao app' }, { id: 'desligamento', rotulo: 'Desligamento' }] as const;
const iniciais = (nome: string) => { const p = nome.trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?'; };

export type Contrato = { id: string; vigencia: string; salario_base: number | string; jornada_semanal_min: number; divisor: number; tipo_escala: string; folgas_semana: number | null; turno: string | null; horas_extras_mensais_min: number };
export type ColabTela = { nome: string; cargo: string | null; setor: string | null; admissao: string; desligamento: string | null };

export const inicioDe = (v: string) => /^[\[(](\d{4}-\d{2}-\d{2})/.exec(v)?.[1] ?? '';
/** "[2026-01-05,2026-06-01)" → "05/01/2026 a 31/05/2026"; sem fim → "desde 05/01/2026". */
function periodo(v: string): string {
  const m = /^[\[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})?[\])]$/.exec(v);
  if (!m) return v;
  if (!m[2]) return `desde ${dataBr(m[1]!)}`;
  const fim = new Date(Date.parse(`${m[2]}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${dataBr(m[1]!)} a ${dataBr(fim)}`;
}

type Props = {
  empresaId: string; colaboradorId: string; colab: ColabTela; contratos: Contrato[]; aba: string; acesso: Acesso; hoje: string;
  valoresPessoa: Record<string, string>; valoresContrato: Record<string, string>; cpfMascarado: string;
};

/** Tela do colaborador: cabeçalho, resumo do contrato e abas (dados pessoais, contrato e escala, acesso ao app, desligamento). */
export function TelaColaborador({ empresaId, colaboradorId, colab, contratos, aba, acesso, hoje, valoresPessoa, valoresContrato, cpfMascarado }: Props) {
  const atual = contratos[0];
  const desligado = colab.desligamento !== null;
  const subtitulo = [colab.cargo, colab.setor].filter(Boolean).join(' · ');
  const base = `/empresas/${empresaId}/colaboradores/${colaboradorId}`;
  return (
    <>
      <Link href={`/empresas/${empresaId}/colaboradores`} className="text-sm font-semibold text-marca hover:underline">← Colaboradores</Link>
      <CabecalhoItem iniciais={iniciais(colab.nome)} titulo={colab.nome} subtitulo={`${subtitulo ? `${subtitulo} · ` : ''}Admitido em ${dataBr(colab.admissao)}`}
        selo={desligado ? <Selo tom="vermelho">Desligado</Selo> : <Selo tom="verde">Ativo</Selo>} />
      {atual ? (
        <ResumoItem rotulo="Resumo do contrato atual" itens={[
          { rotulo: 'Escala', valor: `${atual.tipo_escala}${atual.turno ? ` · ${atual.turno}` : ''}` },
          { rotulo: 'Jornada semanal', valor: <span className="horario">{horasMin(atual.jornada_semanal_min)}</span> },
          { rotulo: 'Salário', valor: <span className="horario">{moeda(Math.round(Number(atual.salario_base) * 100))}</span> },
          { rotulo: 'Valor/hora', valor: <span className="horario">{moedaHora(Math.round((Number(atual.salario_base) / atual.divisor) * 100))}</span> },
        ]} />
      ) : null}
      <Abas abas={[...ABAS]} atual={aba} base={base} rotulo="Seções do colaborador" />

      {aba === 'dados' ? (
        <Cartao icone="pessoas" titulo="Dados pessoais" subtitulo="Identificação e onde a pessoa trabalha.">
          <FormEditarPessoa empresaId={empresaId} colaboradorId={colaboradorId} valores={valoresPessoa} cpfMascarado={cpfMascarado} />
        </Cartao>
      ) : null}

      {aba === 'contrato' ? (
        <>
          <Cartao icone="turnos" titulo="Mudar contrato ou escala" subtitulo="Informe a data em que a mudança passa a valer. O histórico de contratos é mantido.">
            {desligado ? <Aviso>Colaborador desligado: reative para alterar o contrato.</Aviso> : atual
              ? <FormMudarContrato empresaId={empresaId} colaboradorId={colaboradorId} valores={valoresContrato} hoje={hoje} admissao={colab.admissao} />
              : <Aviso>Este colaborador não tem contrato cadastrado.</Aviso>}
          </Cartao>
          {contratos.length > 0 ? (
            <Cartao icone="banco" titulo="Histórico de contratos">
              <ul className="divide-y divide-linha text-sm">
                {contratos.map((k, i) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                    <span className="flex items-center gap-2">{periodo(k.vigencia)}{i === 0 && !desligado ? <Selo tom="azul">Atual</Selo> : null}</span>
                    <span className="text-suave"><span className="horario">R$ {reaisParaTexto(k.salario_base)}</span> · {minutosParaHoras(k.jornada_semanal_min)} h/sem · {k.tipo_escala}{k.turno ? ` · ${k.turno}` : ''}</span>
                  </li>
                ))}
              </ul>
            </Cartao>
          ) : null}
        </>
      ) : null}

      {aba === 'acesso' ? (
        <Cartao icone="pessoas" titulo="Acesso ao aplicativo" subtitulo="Com o acesso, a pessoa vê a própria escala, faz pedidos e acompanha o banco de horas pelo celular.">
          <CelulaAcesso empresaId={empresaId} colaboradorId={colaboradorId} nome={colab.nome} acesso={acesso} podeGerir />
        </Cartao>
      ) : null}

      {aba === 'desligamento' ? (
        <Cartao icone="pedidos" titulo={desligado ? 'Desligamento' : 'Desligar colaborador'}>
          <PainelDesligamento empresaId={empresaId} colaboradorId={colaboradorId} nome={colab.nome} desligamento={colab.desligamento} hoje={hoje} admissao={colab.admissao} />
        </Cartao>
      ) : null}
    </>
  );
}
