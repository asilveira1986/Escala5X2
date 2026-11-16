import { somarDias, type DataISO } from '../datas';
import { resolverRegras } from '../resolver';
import type { ContextoColaborador, Regra, RegrasEfetivas } from '../tipos';
import type { Alocacao, CodigoViolacao, EscalaInput, OpcoesValidacao, Severidade, Violacao } from './tipos';
import { dataBr, dataDoNumero, diaDaSemana, duracao, hhmm, inicioDaSemana, MIN_DIA, numeroDoDia, turnoDe, turnoValido, type Turno } from './tempo';

const RANK: Record<Severidade, number> = { bloqueio: 0, alerta: 1, info: 2 };

export const temBloqueio = (v: Violacao[]): boolean => v.some((x) => x.severidade === 'bloqueio');

/**
 * Valida uma escala contra as regras vigentes em cada data (inclusive na virada de fase da lei).
 * Bloqueio impede publicar; alerta e info orientam. O servidor roda esta mesma função antes de publicar.
 *
 * Limites conhecidos (documentados, não silenciosos):
 *  - turno partido não é suportado (modele como um turno com intervalo);
 *  - cobertura conta só quem cobre a faixa inteira;
 *  - hora extra "programada" (acima do limite diário e dentro do limite de extras) é alerta; acima disso, bloqueio.
 */
export function validarEscala(escala: EscalaInput, contextos: ContextoColaborador[], regras: Regra[], opcoes: OpcoesValidacao = {}): Violacao[] {
  const inicioSemana = opcoes.inicioSemana ?? escala.inicioSemana ?? 1;
  const { inicio: pIni, fim: pFim } = escala.periodo;
  const nIni = numeroDoDia(pIni);
  const nFim = numeroDoDia(pFim);
  const dentro = (d: DataISO) => d >= pIni && d <= pFim;
  const ctxPorId = new Map(contextos.map((c) => [c.colaboradorId, c]));
  const feriados = new Map(escala.feriados?.map((f) => [f.data, f]) ?? []);
  const out: Violacao[] = [];
  const push = (v: Violacao) => out.push(v);

  const memo = new Map<string, RegrasEfetivas>();
  const regrasEm = (ctx: ContextoColaborador, data: DataISO): RegrasEfetivas => {
    const k = `${ctx.colaboradorId}|${data}`;
    let r = memo.get(k);
    if (!r) memo.set(k, (r = resolverRegras(ctx, data, regras)));
    return r;
  };

  const porColab = new Map<string, Alocacao[]>();
  for (const a of [...(escala.anteriores ?? []), ...escala.alocacoes]) (porColab.get(a.colaboradorId) ?? porColab.set(a.colaboradorId, []).get(a.colaboradorId)!).push(a);
  const turnosPorColab = new Map<string, Turno[]>();

  for (const [id, lista] of porColab) {
    const ctx = ctxPorId.get(id);
    if (!ctx) {
      if (lista.some((a) => dentro(a.data))) push({ codigo: 'COLABORADOR_DESCONHECIDO', severidade: 'bloqueio', colaboradorId: id, mensagem: 'Há lançamentos para um colaborador que não faz parte desta escala.', sugestao: 'Remova os lançamentos ou inclua o colaborador no setor.', detalhe: {} });
      continue;
    }
    const nome = ctx.nome;
    const base = (codigo: CodigoViolacao, severidade: Severidade, data: DataISO | undefined, mensagem: string, sugestao: string | undefined, detalhe: Record<string, unknown>, aplicadas?: string[]) =>
      push({ codigo, severidade, colaboradorId: id, data, mensagem, sugestao, detalhe, regrasAplicadas: aplicadas });

    // --- Turnos e vínculo
    for (const a of lista) {
      if (!dentro(a.data) || a.tipo !== 'trabalho') continue;
      if (!turnoValido(a)) {
        base('TURNO_INCOMPLETO', 'bloqueio', a.data, `${nome}: o turno de ${dataBr(a.data)} está incompleto ou inválido.`, 'Informe início e fim (o fim deve ser depois do início, com no máximo 24h) e um intervalo menor que o turno.', { inicioMin: a.inicioMin, fimMin: a.fimMin, intervaloMin: a.intervaloMin });
      }
      if (ctx.admissao && a.data < ctx.admissao) base('FORA_DO_VINCULO', 'bloqueio', a.data, `${nome} só foi admitido(a) em ${dataBr(ctx.admissao)}.`, 'Remova o turno anterior à admissão.', { admissao: ctx.admissao });
      if (ctx.desligamento && a.data > ctx.desligamento) base('FORA_DO_VINCULO', 'bloqueio', a.data, `${nome} foi desligado(a) em ${dataBr(ctx.desligamento)}.`, 'Remova o turno posterior ao desligamento.', { desligamento: ctx.desligamento });
    }

    const turnos = lista.filter(turnoValido).map(turnoDe).filter((t): t is Turno => t !== null).sort((a, b) => a.ini - b.ini);
    turnosPorColab.set(id, turnos);

    // --- Sobreposição e interjornada
    let maiorFim: Turno | null = null;
    let anterior: Turno | null = null;
    for (const t of turnos) {
      if (maiorFim && t.ini < maiorFim.fim && dentro(t.alocacao.data)) {
        base('SOBREPOSICAO_TURNOS', 'bloqueio', t.alocacao.data, `${nome}: o turno de ${dataBr(t.alocacao.data)} sobrepõe o de ${dataBr(maiorFim.alocacao.data)}.`, 'Ajuste os horários para que um turno termine antes de o outro começar.', { outro: maiorFim.alocacao.data });
      } else if (anterior && dentro(t.alocacao.data)) {
        const r = regrasEm(ctx, t.alocacao.data);
        const intervalo = t.ini - anterior.fim;
        if (intervalo < r.interjornadaMin) {
          base('INTERJORNADA', 'bloqueio', t.alocacao.data, `${nome}: só ${duracao(intervalo)} entre o fim do turno de ${dataBr(anterior.alocacao.data)} e o início do de ${dataBr(t.alocacao.data)} (mínimo ${duracao(r.interjornadaMin)}).`,
            `Comece o turno de ${dataBr(t.alocacao.data)} a partir das ${hhmm(anterior.fim + r.interjornadaMin)} ou termine o anterior mais cedo.`, { intervaloMin: intervalo, minimo: r.interjornadaMin }, r.regrasAplicadas);
        }
      }
      if (!maiorFim || t.fim > maiorFim.fim) maiorFim = t;
      anterior = t;
    }

    // --- Cada turno: intrajornada, jornada diária, ausência, feriado
    for (const t of turnos) {
      const data = t.alocacao.data;
      if (!dentro(data)) continue;
      const r = regrasEm(ctx, data);
      const exigido = t.brutoMin > 360 ? r.intervaloMinAcima6hMin : t.brutoMin > 240 ? r.intervaloMin4a6hMin : 0;
      if (t.intervaloMin < exigido) {
        base('INTERVALO_INTRAJORNADA', 'bloqueio', data, `${nome}: turno de ${duracao(t.brutoMin)} em ${dataBr(data)} precisa de intervalo de pelo menos ${duracao(exigido)} (tem ${duracao(t.intervaloMin)}).`, `Inclua um intervalo de ${duracao(exigido)} no turno.`, { exigidoMin: exigido, atualMin: t.intervaloMin }, r.regrasAplicadas);
      } else if (t.intervaloMin > r.intervaloMaxMin) {
        base('INTERVALO_ACIMA_DO_MAXIMO', 'alerta', data, `${nome}: intervalo de ${duracao(t.intervaloMin)} em ${dataBr(data)} excede ${duracao(r.intervaloMaxMin)}, o que só vale com acordo escrito.`, 'Reduza o intervalo ou confirme que há acordo coletivo ou individual.', { maximoMin: r.intervaloMaxMin, atualMin: t.intervaloMin }, r.regrasAplicadas);
      }

      const compensatorio = r.regimeCompensatorio && ctx.tipoEscala === r.regimeCompensatorio.escala;
      const limite = compensatorio ? r.regimeCompensatorio!.maxDiariaMin : r.maxDiariaMin;
      const margem = compensatorio ? 0 : r.maxHoraExtraDiaMin;
      if (t.liquidoMin > limite + margem) {
        base('JORNADA_DIARIA_EXCEDIDA', 'bloqueio', data, `${nome}: ${duracao(t.liquidoMin)} em ${dataBr(data)} excede o máximo de ${duracao(limite + margem)}${margem ? ` (${duracao(limite)} mais até ${duracao(margem)} de horas extras)` : ''}.`,
          `Reduza o turno em ${duracao(t.liquidoMin - limite - margem)} ou mais.`, { trabalhadasMin: t.liquidoMin, limiteMin: limite, margemMin: margem }, r.regrasAplicadas);
      } else if (t.liquidoMin > limite) {
        base('HORA_EXTRA_PROGRAMADA', 'alerta', data, `${nome}: ${duracao(t.liquidoMin - limite)} de hora extra programada em ${dataBr(data)} (jornada de ${duracao(t.liquidoMin)}; limite ${duracao(limite)}).`,
          'Hora extra programada deve ser exceção. Considere redistribuir o turno.', { extraMin: t.liquidoMin - limite, adicionalMinimoPercentual: r.adicionalHePercentual }, r.regrasAplicadas);
      }

      const aus = (escala.ausencias ?? []).find((x) => x.colaboradorId === id && data >= x.inicio && data <= x.fim)
        ?? lista.find((x) => x.data === data && (x.tipo === 'ferias' || x.tipo === 'afastamento'));
      if (aus) base('TRABALHO_EM_AUSENCIA', 'bloqueio', data, `${nome} está em ${'tipo' in aus && aus.tipo === 'ferias' ? 'férias' : 'afastamento'} em ${dataBr(data)}.`, 'Remova o turno desse dia.', {});
      const fer = feriados.get(data);
      if (fer) base('TRABALHO_EM_FERIADO', 'alerta', data, `${nome} trabalha em ${dataBr(data)} (${fer.nome}).`, 'Confirme o pagamento em dobro ou a folga compensatória, conforme a convenção.', { feriado: fer.nome });
    }

    // --- Semanas: limite semanal e folgas
    const semanas = new Set<DataISO>();
    for (let n = nIni; n <= nFim; n++) semanas.add(inicioDaSemana(dataDoNumero(n), inicioSemana));
    const menorAnterior = (escala.anteriores ?? []).reduce<DataISO | null>((m, a) => (m === null || a.data < m ? a.data : m), null);
    for (const w of [...semanas].sort()) {
      const dias = Array.from({ length: 7 }, (_, i) => somarDias(w, i));
      const regrasDosDias = dias.filter((d) => !ctx.admissao || d >= ctx.admissao).map((d) => regrasEm(ctx, d));
      if (regrasDosDias.length === 0) continue;
      const limiteSemanal = Math.min(...regrasDosDias.map((r) => r.maxSemanalMin));
      const folgasExigidas = Math.max(...regrasDosDias.map((r) => r.folgasPorSemana));
      const aplicadas = [...new Set(regrasDosDias.flatMap((r) => r.regrasAplicadas))];
      const turnosDaSemana = turnos.filter((t) => t.alocacao.data >= w && t.alocacao.data <= dias[6]!);

      let acumulado = 0;
      for (const t of turnosDaSemana) {
        acumulado += t.liquidoMin;
        if (acumulado > limiteSemanal) {
          const data = t.alocacao.data;
          if (dentro(data)) base('LIMITE_SEMANAL', 'bloqueio', data, `${nome}: a semana de ${dataBr(w)} passa de ${duracao(limiteSemanal)} (chega a ${duracao(turnosDaSemana.reduce((s, x) => s + x.liquidoMin, 0))}).`, `Reduza ${duracao(turnosDaSemana.reduce((s, x) => s + x.liquidoMin, 0) - limiteSemanal)} nessa semana.`, { semana: w, totalMin: turnosDaSemana.reduce((s, x) => s + x.liquidoMin, 0), limiteMin: limiteSemanal }, aplicadas);
          break;
        }
      }

      const completa = (dias[0]! >= pIni && dias[6]! <= pFim) || (menorAnterior !== null && dias[0]! >= menorAnterior && dias[6]! <= pFim);
      if (completa) {
        const comTrabalho = new Set(turnosDaSemana.map((t) => t.alocacao.data));
        const folgas = dias.filter((d) => !comTrabalho.has(d) && (!ctx.admissao || d >= ctx.admissao)).length;
        const ultimoDia = dias.filter(dentro).pop() ?? dias[6]!;
        if (folgas < folgasExigidas && dias.some((d) => dentro(d))) {
          base('FOLGAS_SEMANA', 'bloqueio', ultimoDia, `${nome}: ${folgas} folga(s) na semana de ${dataBr(w)} (mínimo ${folgasExigidas}).`, `Inclua mais ${folgasExigidas - folgas} dia(s) de folga nessa semana.`, { semana: w, folgas, exigidas: folgasExigidas }, aplicadas);
        }
      }
    }

    // --- Rodízio de domingo (só quando a regra/acordo define)
    let sequencia = 0;
    for (let n = nIni; n <= nFim; n++) {
      const d = dataDoNumero(n);
      if (diaDaSemana(d) !== 0) continue;
      const rod = regrasEm(ctx, d).domingoRodizio;
      const trabalhou = turnos.some((t) => t.alocacao.data === d);
      sequencia = trabalhou ? sequencia + 1 : 0;
      if (rod && sequencia === rod.aCadaNSemanas) {
        base('RODIZIO_DOMINGO', 'bloqueio', d, `${nome} trabalha ${sequencia} domingos seguidos até ${dataBr(d)}; é preciso folgar em pelo menos 1 a cada ${rod.aCadaNSemanas}.`, 'Dê folga em um desses domingos.', { sequencia, aCadaNSemanas: rod.aCadaNSemanas }, regrasEm(ctx, d).regrasAplicadas);
      }
    }
  }

  // --- Cobertura (alerta, nunca bloqueio)
  const demandas = escala.cobertura ?? [];
  if (demandas.length > 0) {
    for (let n = nIni; n <= nFim; n++) {
      const data = dataDoNumero(n);
      const dow = diaDaSemana(data);
      for (const dem of demandas.filter((x) => x.diaSemana === dow)) {
        const fi = n * MIN_DIA + dem.faixaInicioMin;
        const ff = n * MIN_DIA + (dem.faixaFimMin > dem.faixaInicioMin ? dem.faixaFimMin : dem.faixaFimMin + MIN_DIA);
        let atual = 0;
        for (const ts of turnosPorColab.values()) if (ts.some((t) => t.ini <= fi && t.fim >= ff)) atual++;
        const faixa = `${hhmm(dem.faixaInicioMin)} às ${hhmm(dem.faixaFimMin)}`;
        if (atual < dem.minimo) {
          push({ codigo: 'COBERTURA_MINIMA', severidade: 'alerta', data, mensagem: `Cobertura abaixo do mínimo em ${dataBr(data)}, das ${faixa}: ${atual} de ${dem.minimo}.`, sugestao: `Escale mais ${dem.minimo - atual} pessoa(s) cobrindo toda essa faixa.`, detalhe: { faixa, minimo: dem.minimo, atual, faltam: dem.minimo - atual } });
        } else if (dem.ideal !== undefined && atual < dem.ideal) {
          push({ codigo: 'COBERTURA_IDEAL', severidade: 'info', data, mensagem: `Cobertura abaixo do ideal em ${dataBr(data)}, das ${faixa}: ${atual} de ${dem.ideal}.`, detalhe: { faixa, ideal: dem.ideal, atual } });
        }
      }
    }
  }

  return out.sort((a, b) => RANK[a.severidade] - RANK[b.severidade] || (a.data ?? '').localeCompare(b.data ?? '') || (a.colaboradorId ?? '').localeCompare(b.colaboradorId ?? '') || a.codigo.localeCompare(b.codigo));
}
