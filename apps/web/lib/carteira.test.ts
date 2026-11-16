import { describe, expect, it } from 'vitest';
import { diasAte, filtrar, lerFiltro, lerMes, mesVizinho, ordenarPorAtencao, paraCsv, pendencias, pontuacao, resumir, type LinhaCarteira } from './carteira';

const base: LinhaCarteira = {
  empresa_id: 'e', razao_social: 'Alfa', cnpj: '1', porte: 'medio', uf: 'SP', status_adequacao: 'adequado', organizacao_nome: null, colaboradores: 10, sem_contrato: 0,
  diagnostico_id: 'd', diagnostico_em: '2027-02-01', diagnostico_total: 10, diagnostico_a_adequar: 0, escalas_publicadas: 1, escalas_rascunho: 0, ciencias_pendentes: 0, sem_acesso: 0, importacao_erro: false,
};
const l = (extra: Partial<LinhaCarteira>): LinhaCarteira => ({ ...base, ...extra });

describe('carteira', () => {
  it('empresa em dia não tem pendências', () => {
    expect(pendencias(base)).toEqual([]);
    expect(pontuacao(base)).toBe(0);
  });
  it('lista as pendências da mais grave para a menos grave, com texto no singular e no plural', () => {
    const p = pendencias(l({ importacao_erro: true, diagnostico_id: null, diagnostico_em: null, diagnostico_a_adequar: null, sem_contrato: 1, escalas_publicadas: 0, escalas_rascunho: 2, ciencias_pendentes: 1, sem_acesso: 3 }));
    expect(p.map((x) => x.codigo)).toEqual(['importacao', 'sem_diagnostico', 'sem_contrato', 'rascunho', 'ciencia', 'sem_acesso']);
    expect(p.map((x) => x.peso)).toEqual([...p.map((x) => x.peso)].sort((a, b) => b - a));
    expect(p.find((x) => x.codigo === 'sem_contrato')!.texto).toBe('1 colaborador sem contrato vigente');
    expect(p.find((x) => x.codigo === 'rascunho')!.texto).toBe('2 escalas em rascunho');
    expect(p.find((x) => x.codigo === 'ciencia')!.texto).toBe('1 ciência pendente');
  });
  it('diagnóstico com gente a adequar mostra o total; sem equipe pede importação', () => {
    expect(pendencias(l({ diagnostico_a_adequar: 7 }))[0]).toMatchObject({ codigo: 'a_adequar', texto: '7 pessoas precisam se adequar (de 10)', aba: 'diagnostico' });
    expect(pendencias(l({ colaboradores: 0, diagnostico_id: null, escalas_publicadas: 0 })).map((x) => x.codigo)).toEqual(['sem_equipe']); // sem equipe não cobra diagnóstico nem escala
  });
  it('sem escala só cobra de quem tem equipe; rascunho sem publicada também é pendência', () => {
    expect(pendencias(l({ escalas_publicadas: 0 })).map((x) => x.codigo)).toEqual(['sem_escala']);
    expect(pendencias(l({ escalas_publicadas: 0, escalas_rascunho: 1 })).map((x) => x.codigo)).toEqual(['rascunho']);
  });
  it('filtros e ordenação por atenção', () => {
    const a = l({ razao_social: 'Zeta' }), b = l({ razao_social: 'Beta', status_adequacao: 'em_risco', diagnostico_a_adequar: 3 }), c = l({ razao_social: 'Alfa', diagnostico_id: null, diagnostico_em: null, diagnostico_a_adequar: null }), d = l({ razao_social: 'Delta', escalas_publicadas: 0 });
    const todas = [a, b, c, d];
    expect(filtrar(todas, 'todas')).toHaveLength(4);
    expect(filtrar(todas, 'atencao').map((x) => x.razao_social)).toEqual(['Beta', 'Alfa', 'Delta']);
    expect(filtrar(todas, 'em_risco').map((x) => x.razao_social)).toEqual(['Beta']);
    expect(filtrar(todas, 'sem_diagnostico').map((x) => x.razao_social)).toEqual(['Alfa']);
    expect(filtrar(todas, 'escala_pendente').map((x) => x.razao_social)).toEqual(['Delta']);
    expect(ordenarPorAtencao(todas).map((x) => x.razao_social)).toEqual(['Alfa', 'Beta', 'Delta', 'Zeta']); // 45, 35, 25, 0
  });
  it('resume a carteira', () => {
    const r = resumir([base, l({ status_adequacao: 'em_risco', diagnostico_a_adequar: 2, ciencias_pendentes: 4 }), l({ diagnostico_id: null, colaboradores: 5, ciencias_pendentes: 1 })]);
    expect(r).toEqual({ empresas: 3, atencao: 2, emRisco: 1, semDiagnostico: 1, escalaPendente: 0, cienciasPendentes: 5, pessoas: 25 });
  });
  it('lê filtro e mês de parâmetros inseguros, e navega entre meses', () => {
    expect(lerFiltro('em_risco')).toBe('em_risco');
    expect(lerFiltro('drop table')).toBe('todas');
    expect(lerMes('2027-03', '2026-11-16')).toEqual({ mes: '2027-03', dia: '2027-03-01' });
    expect(lerMes('2027-13', '2026-11-16')).toEqual({ mes: '2026-11', dia: '2026-11-01' });
    expect(lerMes(undefined, '2026-11-16').mes).toBe('2026-11');
    expect(mesVizinho('2026-12', 1)).toBe('2027-01');
    expect(mesVizinho('2027-01', -1)).toBe('2026-12');
    expect(mesVizinho('2027-03', -15)).toBe('2025-12');
  });
  it('dias até o prazo', () => {
    expect(diasAte('2026-12-15', '2026-11-16')).toBe(29);
    expect(diasAte('2026-12-15', '2026-12-15')).toBe(0);
    expect(diasAte('2026-12-15', '2026-12-20')).toBe(-5);
  });
  it('CSV para Excel pt-BR: BOM, ponto e vírgula, aspas e proteção contra fórmula', () => {
    const csv = paraCsv([l({ razao_social: '=CMD("x")', cnpj: 'A;B "C"' }), l({ razao_social: 'Normal', diagnostico_a_adequar: 2 })]);
    expect(csv.startsWith('﻿Empresa;CNPJ;UF;')).toBe(true);
    const linhas = csv.trim().split('\r\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toContain(`"'=CMD(""x"")"`);
    expect(linhas[1]).toContain('"A;B ""C"""');
    expect(linhas[2]).toContain('2 pessoas precisam se adequar (de 10)');
    expect(linhas[2]).toContain(';Adequado;10;0;2027-02-01;2;');
  });
});
