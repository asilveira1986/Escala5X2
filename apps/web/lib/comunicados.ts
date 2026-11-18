import type { DadosComunicados } from '@jc/documents';
import type { Diagnostico, Regra } from '@jc/rules-engine';
import { SEM_SETOR, type Fase } from '@/lib/prontidao';

/** Quem recebe comunicado na fase: perde horas na fase e não está numa exceção (alta renda ou acordo), que seguem regra própria. */
export type ItemSelecionado = DadosComunicados['itens'][number] & { colaboradorId: string };
export function selecionarComunicados(d: Diagnostico, regras: Regra[], fase: Fase, setor: string | null): { fase: DadosComunicados['fase']; itens: ItemSelecionado[] } | null {
  const codigo = fase === 'F1' ? 'EC141_F1' : 'EC141_F2';
  const regra = regras.find((r) => r.ativa && r.codigo === codigo && Object.keys(r.escopo).length === 0);
  const inicio = fase === 'F1' ? d.fases.f1Inicio : d.fases.f2Inicio;
  if (!regra || !inicio) return null;
  const folgas = Number(regra.parametros.folgas_semana) || 2;
  const itens = d.itens
    .filter((i) => i.classificacao !== 'excecao')
    .filter((i) => (setor === null ? true : (i.setor ?? SEM_SETOR) === setor))
    .flatMap((i) => {
      const e = fase === 'F1' ? i.f1 : i.f2;
      return e && e.horasPerdidasMin > 0 ? [{ colaboradorId: i.colaboradorId, nome: i.nome, setor: i.setor, jornadaAtualMin: i.horasAtuaisMin, novaJornadaMin: e.horasAlvoMin }] : [];
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { fase: { rotulo: fase === 'F1' ? 'Fase 1' : 'Fase 2', inicio, diasTrabalho: 7 - folgas, diasRepouso: folgas }, itens };
}

/** Itens no formato da função `emitir_comunicados`. */
export const paraEmissao = (sel: NonNullable<ReturnType<typeof selecionarComunicados>>) =>
  sel.itens.map((i) => ({ colaboradorId: i.colaboradorId, inicio: sel.fase.inicio, jornadaAtualMin: i.jornadaAtualMin, novaJornadaMin: i.novaJornadaMin, diasTrabalho: sel.fase.diasTrabalho, diasRepouso: sel.fase.diasRepouso }));
