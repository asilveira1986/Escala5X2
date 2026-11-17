import type { CelulaEscala, DadosEscalaDoc } from '@jc/documents';
import { dataDoNumero, diaDaSemana, duracao, hhmm, numeroDoDia } from '@jc/rules-engine';
import type { EntradaEscala } from '@jc/servicos';

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type Extra = { empresa: { razaoSocial: string; cnpj: string }; setor: string | null; hash: string | null; geradoEm: string; nomesModelos?: Record<string, string> };

/**
 * Monta o que o PDF/Excel desenham a partir da escala carregada: um código (A, B…) para cada horário de turno diferente,
 * "F" nas folgas, FÉR/AFA nas ausências, e os totais por pessoa e por dia. Pessoas em ordem alfabética.
 */
export function montarDadosEscala(entrada: EntradaEscala, x: Extra): DadosEscalaDoc {
  const { inicio, fim } = entrada.escala;
  const dias = Array.from({ length: numeroDoDia(fim) - numeroDoDia(inicio) + 1 }, (_, i) => { const data = dataDoNumero(numeroDoDia(inicio) + i); return { data, diaSemana: diaDaSemana(data), feriado: entrada.feriados.some((f) => f.data === data) }; });

  // um código por horário distinto, na ordem do começo do turno
  const chaveTurno = (a: { inicioMin?: number; fimMin?: number; intervaloMin?: number }) => `${a.inicioMin}|${a.fimMin}|${a.intervaloMin ?? 0}`;
  const trabalho = entrada.alocacoes.filter((a) => a.tipo === 'trabalho' && a.inicioMin != null && a.fimMin != null);
  const distintos = [...new Map(trabalho.map((a) => [chaveTurno(a), a])).values()].sort((a, b) => a.inicioMin! - b.inicioMin! || a.fimMin! - b.fimMin!);
  const codigo = new Map(distintos.map((a, i) => [chaveTurno(a), { cod: LETRAS[i] ?? String(i + 1), i }]));
  const legenda = distintos.map((a, i) => {
    const nome = a.modeloId ? x.nomesModelos?.[a.modeloId] : undefined;
    return { codigo: codigo.get(chaveTurno(a))!.cod, indiceTurno: i, descricao: `${nome ? `${nome} ` : ''}${hhmm(a.inicioMin!)}–${hhmm(a.fimMin!)}${a.intervaloMin ? ` (intervalo ${duracao(a.intervaloMin)})` : ''}` };
  });

  const ausente = (id: string, data: string) => entrada.ausencias.find((a) => a.colaboradorId === id && data >= a.inicio && data <= a.fim);
  const linhas = [...entrada.colaboradores].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((c) => {
    const meus = entrada.alocacoes.filter((a) => a.colaboradorId === c.colaboradorId);
    let diasTrabalhados = 0, horasMin = 0;
    const celulas: CelulaEscala[] = dias.map((d) => {
      const doDia = meus.filter((a) => a.data === d.data);
      const trab = doDia.filter((a) => a.tipo === 'trabalho' && a.inicioMin != null && a.fimMin != null);
      if (trab.length > 0) {
        diasTrabalhados++; horasMin += trab.reduce((s, a) => s + (a.fimMin! - a.inicioMin! - (a.intervaloMin ?? 0)), 0);
        const cs = trab.map((a) => codigo.get(chaveTurno(a))!);
        return { texto: cs.map((k) => k.cod).join('/'), tipo: 'trabalho', indiceTurno: cs[0]!.i };
      }
      const aus = ausente(c.colaboradorId, d.data);
      if (doDia.some((a) => a.tipo === 'ferias') || aus?.tipo === 'ferias') return { texto: 'FÉR', tipo: 'ferias' };
      if (doDia.some((a) => a.tipo === 'afastamento') || aus?.tipo === 'afastamento') return { texto: 'AFA', tipo: 'afastamento' };
      if (doDia.some((a) => a.tipo === 'folga' || a.tipo === 'dsr' || a.tipo === 'feriado')) return { texto: 'F', tipo: 'folga' };
      return { texto: '', tipo: 'vazio' };
    });
    return { nome: c.nome, celulas, diasTrabalhados, horasMin };
  });
  const cobertura = dias.map((_, i) => linhas.filter((l) => l.celulas[i]!.tipo === 'trabalho').length);

  return {
    empresa: x.empresa, nome: entrada.escala.nome, setor: x.setor, periodo: { inicio, fim }, status: entrada.escala.status, versao: entrada.escala.versao,
    hash: x.hash, geradoEm: x.geradoEm, dias, linhas, legenda, cobertura,
  };
}

/** escala-loja-alfa-2027-03-v2.pdf (sem acentos, só minúsculas, números e hífen). */
export function nomeArquivoEscala(razaoSocial: string, inicio: string, versao: number, extensao: 'pdf' | 'xlsx'): string {
  const slug = razaoSocial.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'empresa';
  return `escala-${slug}-${inicio.slice(0, 7)}-v${versao}.${extensao}`;
}
