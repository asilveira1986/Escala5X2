import { describe, expect, it } from 'vitest';
import { calcularHoras, somarDias, temBloqueio, validarEscala, type AcordoDoColaborador, type Violacao } from '../src';
import { REGRAS_SEED as R } from '../src/fixtures/regras';
import { acordo, colab } from './util';
import { c5x2, diasDeTrabalho, folga, hm, turno } from './escala-util';

const codigos = (v: Violacao[]) => v.map((x) => x.codigo);
const bloqueios = (v: Violacao[]) => v.filter((x) => x.severidade === 'bloqueio').map((x) => x.codigo);

// Semana de referência: 04/01/2027 (segunda) a 10/01/2027 (domingo), fase 1 da lei (42h, 2 folgas).
const SEG = '2027-01-04';
const semana = { inicio: SEG, fim: '2027-01-10' };

describe('escala válida', () => {
  it('5x2 de 8h com 1h de intervalo não gera nenhuma violação', () => {
    const v = validarEscala({ periodo: semana, alocacoes: diasDeTrabalho('a', SEG, 5) }, [c5x2('a')], R);
    expect(v).toEqual([]);
  });
});

describe('limite semanal e folgas', () => {
  it('6 dias de 8h: passa de 42h e deixa só 1 folga', () => {
    const v = validarEscala({ periodo: semana, alocacoes: diasDeTrabalho('a', SEG, 6) }, [c5x2('a')], R);
    expect(bloqueios(v).sort()).toEqual(['FOLGAS_SEMANA', 'LIMITE_SEMANAL']);
    const lim = v.find((x) => x.codigo === 'LIMITE_SEMANAL')!;
    expect(lim.data).toBe('2027-01-09'); // o turno que estoura o limite (6º dia)
    expect(lim.detalhe).toMatchObject({ totalMin: 2880, limiteMin: 2520 });
    expect(lim.regrasAplicadas).toContain('EC141_F1');
    expect(v.find((x) => x.codigo === 'FOLGAS_SEMANA')!.mensagem).toContain('1 folga(s) na semana de 04/01/2027 (mínimo 2)');
  });
  it('6 dias de 7h (42h) cumprem o teto, mas continuam com 1 folga só', () => {
    const v = validarEscala({ periodo: semana, alocacoes: diasDeTrabalho('a', SEG, 6, '08:00', '16:00') }, [c5x2('a')], R);
    expect(bloqueios(v)).toEqual(['FOLGAS_SEMANA']);
  });
  it('exatamente 42h em 5 dias de 8h24 respeita o limite da fase 1', () => {
    const v = validarEscala({ periodo: semana, alocacoes: diasDeTrabalho('a', SEG, 5, '08:00', '17:24') }, [c5x2('a')], R);
    expect(bloqueios(v)).toEqual(['JORNADA_DIARIA_EXCEDIDA'].slice(0, 0));
    expect(codigos(v)).toEqual(['HORA_EXTRA_PROGRAMADA', 'HORA_EXTRA_PROGRAMADA', 'HORA_EXTRA_PROGRAMADA', 'HORA_EXTRA_PROGRAMADA', 'HORA_EXTRA_PROGRAMADA']);
  });
  it('semana incompleta no fim do período não exige folgas, mas o limite semanal já vale', () => {
    const curto = { inicio: SEG, fim: '2027-01-06' };
    expect(validarEscala({ periodo: curto, alocacoes: diasDeTrabalho('a', SEG, 3) }, [c5x2('a')], R)).toEqual([]);
    const v = validarEscala({ periodo: curto, alocacoes: diasDeTrabalho('a', SEG, 3, '06:00', '17:00', 60) }, [c5x2('a')], R);
    expect(codigos(v)).toContain('HORA_EXTRA_PROGRAMADA');
  });
  it('semana começando no domingo (configurável)', () => {
    // dom 03/01 a sáb 09/01: 5 dias seg–sex → 2 folgas (dom e sáb), válido nas duas convenções
    const v = validarEscala({ periodo: { inicio: '2027-01-03', fim: '2027-01-09' }, alocacoes: diasDeTrabalho('a', SEG, 5), inicioSemana: 0 }, [c5x2('a')], R);
    expect(v).toEqual([]);
  });
});

describe('virada de fase da lei (14/12/2026 → 15/12/2026)', () => {
  const pad6x1 = (seg: string) => diasDeTrabalho('a', seg, 6, '08:00', '16:00'); // 6 × 7h = 42h, 1 folga
  const ctx = colab({ colaboradorId: 'a', nome: 'Pessoa a' }); // 6x1 de 44h
  it('semana inteira no legado: 6x1 de 42h é válida (1 folga, até 44h)', () => {
    expect(bloqueios(validarEscala({ periodo: { inicio: '2026-12-07', fim: '2026-12-13' }, alocacoes: pad6x1('2026-12-07') }, [ctx], R))).toEqual([]);
  });
  it('semana que atravessa a virada usa o critério mais rígido: faltam folgas', () => {
    const v = validarEscala({ periodo: { inicio: '2026-12-14', fim: '2026-12-20' }, alocacoes: pad6x1('2026-12-14') }, [ctx], R);
    expect(bloqueios(v)).toEqual(['FOLGAS_SEMANA']);
    expect(v[0]!.regrasAplicadas).toEqual(expect.arrayContaining(['LEGADO_44H', 'EC141_F1']));
  });
  it('semana inteira na fase 1: o mesmo 6x1 é bloqueado', () => {
    expect(bloqueios(validarEscala({ periodo: { inicio: '2026-12-21', fim: '2026-12-27' }, alocacoes: pad6x1('2026-12-21') }, [ctx], R))).toEqual(['FOLGAS_SEMANA']);
  });
  it('na fase 2 (a partir de 15/12/2027) o teto cai para 40h', () => {
    const v = validarEscala({ periodo: { inicio: '2027-12-20', fim: '2027-12-26' }, alocacoes: diasDeTrabalho('a', '2027-12-20', 5, '08:00', '17:24') }, [c5x2('a')], R);
    expect(bloqueios(v)).toEqual(['LIMITE_SEMANAL']);
  });
});

describe('interjornada', () => {
  const inter = (a: Parameters<typeof turno>, b: Parameters<typeof turno>) => validarEscala({ periodo: semana, alocacoes: [turno(...a), turno(...b)] }, [c5x2('a')], R);
  it.each([
    ['8h entre turnos', ['a', '2027-01-04', '14:00', '22:00'], ['a', '2027-01-05', '06:00', '14:00'], true],
    ['exatamente 11h', ['a', '2027-01-04', '14:00', '22:00'], ['a', '2027-01-05', '09:00', '17:00'], false],
    ['10h59 (um minuto a menos)', ['a', '2027-01-04', '14:00', '22:00'], ['a', '2027-01-05', '08:59', '16:59'], true],
  ] as const)('%s', (_n, a, b, quebra) => {
    const v = inter([...a], [...b]);
    expect(bloqueios(v).includes('INTERJORNADA')).toBe(quebra);
  });
  it('a sugestão diz a hora mínima para o próximo turno', () => {
    const v = inter(['a', '2027-01-04', '14:00', '22:00'], ['a', '2027-01-05', '06:00', '14:00']);
    expect(v[0]!.sugestao).toContain('09:00');
    expect(v[0]!.mensagem).toContain('só 8h entre');
  });
  it('turno noturno que cruza a meia-noite conta o fim no dia seguinte', () => {
    const noturno = ['a', '2027-01-04', '22:00', '06:00'] as const; // termina terça 06:00
    expect(bloqueios(inter([...noturno], ['a', '2027-01-05', '14:00', '22:00']))).toContain('INTERJORNADA'); // 8h
    expect(bloqueios(inter([...noturno], ['a', '2027-01-05', '17:00', '22:00']))).not.toContain('INTERJORNADA'); // 11h
  });
  it('usa os turnos do período anterior (virada do mês)', () => {
    const v = validarEscala({
      periodo: semana, anteriores: [turno('a', '2027-01-03', '22:00', '06:00')],
      alocacoes: [turno('a', '2027-01-04', '08:00', '16:00')],
    }, [c5x2('a')], R);
    expect(bloqueios(v)).toEqual(['INTERJORNADA']);
    expect(v[0]!.detalhe).toMatchObject({ intervaloMin: 120 });
  });
  it('turnos sobrepostos são bloqueio próprio, inclusive virando a noite', () => {
    const v = inter(['a', '2027-01-04', '22:00', '06:00'], ['a', '2027-01-05', '05:00', '13:00']);
    expect(bloqueios(v)).toEqual(['SOBREPOSICAO_TURNOS']);
  });
});

describe('intervalo intrajornada e jornada diária', () => {
  const um = (ini: string, fim: string, intervalo: number) => validarEscala({ periodo: semana, alocacoes: [turno('a', SEG, ini, fim, intervalo)] }, [c5x2('a')], R);
  it.each([
    ['9h bruto sem intervalo: exige 1h', '08:00', '17:00', 0, ['INTERVALO_INTRAJORNADA']],
    ['9h bruto com 30 min: ainda exige 1h', '08:00', '17:00', 30, ['INTERVALO_INTRAJORNADA']],
    ['6h exatas sem intervalo: cai na faixa de 15 min', '08:00', '14:00', 0, ['INTERVALO_INTRAJORNADA']],
    ['6h exatas com 15 min: ok', '08:00', '14:00', 15, []],
    ['6h01 exige 1h', '08:00', '14:01', 0, ['INTERVALO_INTRAJORNADA']],
    ['5h sem intervalo: exige 15 min', '08:00', '13:00', 0, ['INTERVALO_INTRAJORNADA']],
    ['5h com 15 min: ok', '08:00', '13:00', 15, []],
    ['4h exatas: sem intervalo', '08:00', '12:00', 0, []],
    ['intervalo de 2h30: acima do máximo (alerta)', '08:00', '19:30', 150, ['INTERVALO_ACIMA_DO_MAXIMO', 'HORA_EXTRA_PROGRAMADA'].slice(0, 1)],
  ] as const)('%s', (_n, ini, fim, intervalo, esperado) => {
    const v = um(ini, fim, intervalo);
    expect(codigos(v).filter((c) => c.startsWith('INTERVALO'))).toEqual([...esperado]);
  });
  it('jornada de 9h líquidas é hora extra programada (alerta); 11h passa do limite de extras (bloqueio)', () => {
    const nove = um('08:00', '18:00', 60);
    expect(codigos(nove)).toEqual(['HORA_EXTRA_PROGRAMADA']);
    expect(nove[0]!.detalhe).toMatchObject({ extraMin: 60, adicionalMinimoPercentual: 50 });
    const onze = um('08:00', '20:00', 60);
    expect(bloqueios(onze)).toEqual(['JORNADA_DIARIA_EXCEDIDA']);
    expect(onze[0]!.sugestao).toContain('Reduza o turno em 1h');
    expect(codigos(um('08:00', '19:00', 60))).toEqual(['HORA_EXTRA_PROGRAMADA']); // 10h líquidas: no limite exato
  });
  it('turno inválido: sem fim, fim antes do início, mais de 24h, intervalo do tamanho do turno, minutos fracionados', () => {
    const casos: Array<Partial<{ inicioMin: number; fimMin: number; intervaloMin: number }>> = [
      { fimMin: undefined }, { inicioMin: 600, fimMin: 480 }, { inicioMin: 0, fimMin: 1500 }, { inicioMin: 480, fimMin: 540, intervaloMin: 60 }, { inicioMin: 480.5, fimMin: 960 },
    ];
    for (const c of casos) {
      const a = { colaboradorId: 'a', data: SEG, tipo: 'trabalho' as const, inicioMin: 480, fimMin: 960, intervaloMin: 0, ...c };
      expect(codigos(validarEscala({ periodo: semana, alocacoes: [a] }, [c5x2('a')], R)), JSON.stringify(c)).toContain('TURNO_INCOMPLETO');
    }
  });
});

describe('férias, feriado, vínculo e colaborador desconhecido', () => {
  it('trabalho durante férias é bloqueio; fora delas, não', () => {
    const aus = [{ colaboradorId: 'a', inicio: '2027-01-05', fim: '2027-01-06', tipo: 'ferias' as const }];
    const v = validarEscala({ periodo: semana, ausencias: aus, alocacoes: [turno('a', '2027-01-04'), turno('a', '2027-01-05'), turno('a', '2027-01-07')] }, [c5x2('a')], R);
    expect(v.filter((x) => x.codigo === 'TRABALHO_EM_AUSENCIA').map((x) => x.data)).toEqual(['2027-01-05']);
    expect(v.find((x) => x.codigo === 'TRABALHO_EM_AUSENCIA')!.mensagem).toContain('férias');
  });
  it('alocação de tipo férias/afastamento no mesmo dia também bloqueia', () => {
    const v = validarEscala({ periodo: semana, alocacoes: [turno('a', SEG), { colaboradorId: 'a', data: SEG, tipo: 'afastamento' }] }, [c5x2('a')], R);
    expect(bloqueios(v)).toEqual(['TRABALHO_EM_AUSENCIA']);
  });
  it('trabalho em feriado é alerta com o nome do feriado', () => {
    const v = validarEscala({ periodo: { inicio: '2026-12-28', fim: '2027-01-03' }, feriados: [{ data: '2027-01-01', nome: 'Confraternização Universal', abrangencia: 'nacional' }], alocacoes: diasDeTrabalho('a', '2026-12-28', 5) }, [c5x2('a')], R);
    expect(v.map((x) => [x.codigo, x.severidade, x.data])).toEqual([['TRABALHO_EM_FERIADO', 'alerta', '2027-01-01']]);
    expect(v[0]!.mensagem).toContain('Confraternização Universal');
  });
  it('turno antes da admissão ou depois do desligamento', () => {
    const ctx = c5x2('a', { admissao: '2027-01-06', desligamento: '2027-01-08' });
    const v = validarEscala({ periodo: semana, alocacoes: [turno('a', '2027-01-05'), turno('a', '2027-01-06'), turno('a', '2027-01-09')] }, [ctx], R);
    expect(v.filter((x) => x.codigo === 'FORA_DO_VINCULO').map((x) => x.data)).toEqual(['2027-01-05', '2027-01-09']);
  });
  it('lançamento de quem não está na escala', () => {
    const v = validarEscala({ periodo: semana, alocacoes: [turno('fantasma', SEG)] }, [c5x2('a')], R);
    expect(bloqueios(v)).toEqual(['COLABORADOR_DESCONHECIDO']);
  });
});

describe('rodízio de domingo (cláusula de acordo)', () => {
  const rod = (n: number): AcordoDoColaborador => acordo(null, null, [{ tipo: 'rodizio_domingo', parametros: { a_cada_n_semanas: n } }]);
  const periodo = { inicio: '2027-01-04', fim: '2027-01-24' }; // domingos 10, 17 e 24/01
  const trabalhaDomingos = (domingos: string[]) => domingos.map((d) => turno('a', d));
  const ctx = colab({ colaboradorId: 'a', nome: 'Pessoa a', acordos: [rod(3)] });
  it('3 domingos seguidos com rodízio de 3 em 3 semanas: bloqueio no terceiro', () => {
    const v = validarEscala({ periodo, alocacoes: trabalhaDomingos(['2027-01-10', '2027-01-17', '2027-01-24']) }, [ctx], R);
    const r = v.find((x) => x.codigo === 'RODIZIO_DOMINGO')!;
    expect(r.data).toBe('2027-01-24');
    expect(r.detalhe).toMatchObject({ sequencia: 3, aCadaNSemanas: 3 });
  });
  it('com uma folga entre eles, não há violação de rodízio', () => {
    const v = validarEscala({ periodo, alocacoes: trabalhaDomingos(['2027-01-10', '2027-01-24']) }, [ctx], R);
    expect(codigos(v)).not.toContain('RODIZIO_DOMINGO');
  });
  it('sem a cláusula, a regra não se aplica', () => {
    const v = validarEscala({ periodo, alocacoes: trabalhaDomingos(['2027-01-10', '2027-01-17', '2027-01-24']) }, [colab({ colaboradorId: 'a', nome: 'x' })], R);
    expect(codigos(v)).not.toContain('RODIZIO_DOMINGO');
  });
});

describe('12x36 por acordo coletivo', () => {
  const clausula = { tipo: 'regime_compensatorio' as const, parametros: { escala: '12x36', max_diaria_min: 720, max_semanal_min: 2640, folgas_semana: 3 } };
  const ctx12 = (acordos: AcordoDoColaborador[]) => colab({ colaboradorId: 'a', nome: 'Pessoa a', tipoEscala: '12x36', acordos });
  const alternados = (inicio: string, n: number) => Array.from({ length: n }, (_, i) => turno('a', somarDias(inicio, i * 2), '07:00', '19:00', 60));
  const mes = { inicio: '2027-01-04', fim: '2027-01-17' };
  it('com acordo vigente: dias alternados de 11h líquidas são válidos', () => {
    const v = validarEscala({ periodo: mes, alocacoes: alternados('2027-01-04', 7) }, [ctx12([acordo('2026-01-01', null, [clausula])])], R);
    expect(bloqueios(v)).toEqual([]);
  });
  it('sem acordo, o mesmo padrão estoura a jornada diária', () => {
    const v = validarEscala({ periodo: mes, alocacoes: alternados('2027-01-04', 7) }, [ctx12([])], R);
    expect(bloqueios(v)).toContain('JORNADA_DIARIA_EXCEDIDA');
  });
  it('acordo vencido não vale', () => {
    const v = validarEscala({ periodo: mes, alocacoes: alternados('2027-01-04', 7) }, [ctx12([acordo('2026-01-01', '2027-01-10', [clausula])])], R);
    expect(bloqueios(v)).toContain('JORNADA_DIARIA_EXCEDIDA'); // a partir de 10/01 o acordo já não cobre
  });
});

describe('cobertura mínima (alerta, nunca bloqueio)', () => {
  const dem = [{ diaSemana: 1, faixaInicioMin: hm('08:00'), faixaFimMin: hm('12:00'), minimo: 2, ideal: 3 }];
  const ctxs = [c5x2('a'), c5x2('b'), c5x2('c')];
  it('abaixo do mínimo gera alerta com quanto falta; no mínimo, só informa o ideal', () => {
    const um = validarEscala({ periodo: semana, cobertura: dem, alocacoes: [turno('a', SEG), folga('b', SEG)] }, ctxs, R);
    expect(um.map((x) => [x.codigo, x.severidade, x.data])).toEqual([['COBERTURA_MINIMA', 'alerta', SEG]]);
    expect(um[0]!.detalhe).toMatchObject({ minimo: 2, atual: 1, faltam: 1 });
    const dois = validarEscala({ periodo: semana, cobertura: dem, alocacoes: [turno('a', SEG), turno('b', SEG)] }, ctxs, R);
    expect(dois.map((x) => x.codigo)).toEqual(['COBERTURA_IDEAL']);
    const tres = validarEscala({ periodo: semana, cobertura: dem, alocacoes: [turno('a', SEG), turno('b', SEG), turno('c', SEG)] }, ctxs, R);
    expect(tres).toEqual([]);
    expect(temBloqueio(um)).toBe(false);
  });
  it('só conta quem cobre a faixa inteira', () => {
    const v = validarEscala({ periodo: semana, cobertura: dem, alocacoes: [turno('a', SEG, '08:00', '11:00', 0), turno('b', SEG, '08:00', '17:00')] }, ctxs, R);
    expect(v.find((x) => x.codigo === 'COBERTURA_MINIMA')!.detalhe).toMatchObject({ atual: 1 });
  });
  it('faixa noturna que cruza a meia-noite é coberta por turno noturno', () => {
    const noite = [{ diaSemana: 1, faixaInicioMin: hm('22:00'), faixaFimMin: hm('06:00'), minimo: 1 }];
    const ok = validarEscala({ periodo: semana, cobertura: noite, alocacoes: [turno('a', SEG, '22:00', '06:00')] }, ctxs, R);
    expect(codigos(ok)).not.toContain('COBERTURA_MINIMA');
    const falta = validarEscala({ periodo: semana, cobertura: noite, alocacoes: [turno('a', SEG, '22:00', '05:00', 0)] }, ctxs, R);
    expect(codigos(falta)).toContain('COBERTURA_MINIMA');
  });
  it('turno que começou no dia anterior cobre a madrugada do dia seguinte', () => {
    const madrugada = [{ diaSemana: 2, faixaInicioMin: hm('00:00'), faixaFimMin: hm('04:00'), minimo: 1 }];
    const v = validarEscala({ periodo: semana, cobertura: madrugada, alocacoes: [turno('a', SEG, '22:00', '06:00')] }, ctxs, R);
    expect(codigos(v)).not.toContain('COBERTURA_MINIMA');
  });
});

describe('ordenação e desempenho', () => {
  it('bloqueios vêm antes de alertas e infos', () => {
    const v = validarEscala({
      periodo: semana, cobertura: [{ diaSemana: 1, faixaInicioMin: 480, faixaFimMin: 720, minimo: 5, ideal: 6 }],
      alocacoes: [...diasDeTrabalho('a', SEG, 6), turno('a', SEG, '08:00', '18:00', 60)],
    }, [c5x2('a')], R);
    const rank = { bloqueio: 0, alerta: 1, info: 2 };
    const ranks = v.map((x) => rank[x.severidade]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[0]).toBe(0);
  });
  it('um mês de 30 pessoas, com folgas alternadas, é válido e roda em menos de 500 ms', () => {
    const ctxs = Array.from({ length: 30 }, (_, i) => c5x2(`p${i}`));
    const alocacoes = ctxs.flatMap((c, i) => {
      const deslocamento = i % 3; // 0: seg–sex; 1: ter–sáb; 2: qua–dom
      return [0, 7, 14, 21].flatMap((sem) => diasDeTrabalho(c.colaboradorId, somarDias('2027-02-01', sem + deslocamento), 5));
    });
    const t = performance.now();
    const v = validarEscala({ periodo: { inicio: '2027-02-01', fim: '2027-02-28' }, alocacoes: alocacoes.filter((a) => a.data <= '2027-02-28') }, ctxs, R);
    expect(performance.now() - t).toBeLessThan(500);
    expect(bloqueios(v)).toEqual([]);
  });
  it('mutação: acrescentar um dia de trabalho a qualquer pessoa de uma escala válida gera bloqueio de folgas', () => {
    const ctxs = Array.from({ length: 6 }, (_, i) => c5x2(`p${i}`));
    const base = ctxs.flatMap((c) => diasDeTrabalho(c.colaboradorId, SEG, 5));
    expect(bloqueios(validarEscala({ periodo: semana, alocacoes: base }, ctxs, R))).toEqual([]);
    for (const c of ctxs) {
      const v = validarEscala({ periodo: semana, alocacoes: [...base, turno(c.colaboradorId, '2027-01-09')] }, ctxs, R);
      expect(v.filter((x) => x.severidade === 'bloqueio').map((x) => [x.colaboradorId, x.codigo])).toContainEqual([c.colaboradorId, 'FOLGAS_SEMANA']);
    }
  });
});

describe('calcularHoras', () => {
  const lim = { maxDiariaMin: 480, maxSemanalMin: 2400 };
  it('5x2 de 8h: 40h normais, nenhuma extra', () => {
    const r = calcularHoras(diasDeTrabalho('a', SEG, 5), [], { ...lim, periodo: semana });
    expect(r).toMatchObject({ trabalhadasMin: 2400, normaisMin: 2400, extrasMin: 0, diasTrabalhados: 5, domingosFolgados: 1, domingosTrabalhados: 0 });
  });
  it('extras diárias: o que passa do limite do dia', () => {
    const r = calcularHoras([turno('a', SEG, '08:00', '19:00', 60)], [], lim); // 10h líquidas
    expect(r).toMatchObject({ trabalhadasMin: 600, extrasMin: 120, normaisMin: 480 });
    expect(r.porDia[0]).toMatchObject({ data: SEG, extrasDiariasMin: 120 });
  });
  it('extras semanais: 6 dias de 8h passam das 40h sem extras diárias', () => {
    const r = calcularHoras(diasDeTrabalho('a', SEG, 6), [], lim);
    expect(r).toMatchObject({ trabalhadasMin: 2880, extrasMin: 480, normaisMin: 2400 });
  });
  it('extras diárias e semanais não contam duas vezes a mesma hora', () => {
    // 4 dias de 10h (extras diárias de 2h cada = 8h) + normais 4×8h = 32h < 40h: sem extras semanais
    const r = calcularHoras(diasDeTrabalho('a', SEG, 4, '08:00', '19:00'), [], lim);
    expect(r).toMatchObject({ trabalhadasMin: 2400, extrasMin: 480, normaisMin: 1920 });
  });
  it('limites podem variar por data (virada de fase)', () => {
    const f = { maxDiariaMin: 480, maxSemanalMin: (d: string) => (d < '2026-12-15' ? 2640 : 2520) };
    expect(calcularHoras(diasDeTrabalho('a', '2026-12-07', 6, '08:00', '16:00'), [], f).extrasMin).toBe(0); // 42h ≤ 44h
    expect(calcularHoras(diasDeTrabalho('a', '2026-12-21', 6, '08:00', '17:00'), [], f).extrasMin).toBe(2880 - 2520);
  });
  it.each([
    ['22:00–06:00, 1h de intervalo', '22:00', '06:00', 60, 420, 480], // 7h noturnas de relógio = 8h pela hora reduzida
    ['20:00–04:00, 1h de intervalo', '20:00', '04:00', 60, 360, 411],
    ['23:00–07:00, 2h de intervalo', '23:00', '07:00', 120, 360, 411],
    ['22:00–04:00, 1h de intervalo (tudo noturno)', '22:00', '04:00', 60, 300, 343],
    ['08:00–17:00 (diurno)', '08:00', '17:00', 60, 0, 0],
    ['05:00–13:00 (começa quando o noturno acaba)', '05:00', '13:00', 60, 0, 0],
  ] as const)('noturno: %s', (_n, ini, fim, interv, relogio, computado) => {
    const r = calcularHoras([turno('a', SEG, ini, fim, interv)], [], { maxDiariaMin: 600, maxSemanalMin: 2520 });
    expect(r.noturnasRelogioMin).toBe(relogio);
    expect(r.noturnasComputadasMin).toBe(computado);
  });
  it('domingos e feriados trabalhados e folgados no período', () => {
    const feriados = [{ data: '2027-04-21', nome: 'Tiradentes', abrangencia: 'nacional' as const }, { data: '2027-04-26', nome: 'Municipal', abrangencia: 'municipal' as const }];
    const r = calcularHoras([turno('a', '2027-04-21'), turno('a', '2027-04-18')], feriados, { ...lim, periodo: { inicio: '2027-04-01', fim: '2027-04-30' } });
    expect(r).toMatchObject({ feriadoMin: 480, feriadosTrabalhados: 1, feriadosFolgados: 1, domingoMin: 480, domingosTrabalhados: 1, domingosFolgados: 3 });
  });
  it('vários turnos no mesmo dia somam no dia', () => {
    const r = calcularHoras([turno('a', SEG, '06:00', '10:00', 0), turno('a', SEG, '14:00', '20:00', 0)], [], lim);
    expect(r.porDia).toHaveLength(1);
    expect(r.porDia[0]).toMatchObject({ trabalhadasMin: 600, extrasDiariasMin: 120 });
  });
  it('sem lançamentos devolve zeros', () => {
    expect(calcularHoras([], [], lim)).toMatchObject({ trabalhadasMin: 0, extrasMin: 0, diasTrabalhados: 0, porDia: [] });
  });
});
