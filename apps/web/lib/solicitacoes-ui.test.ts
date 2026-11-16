import { describe, expect, it } from 'vitest';
import { ABERTA, descreverPedido, opcoesColega, ROTULO_STATUS, ROTULO_TIPO } from './solicitacoes-ui';

const base = { solicitante_nome: 'Ana', destinatario_nome: 'Bia' };
describe('apresentação das solicitações', () => {
  it('descreve cada tipo de pedido em português', () => {
    expect(descreverPedido({ ...base, tipo: 'troca_turno', payload: { dataSolicitante: '2027-02-01', dataColega: '2027-02-01' } })).toBe('Ana e Bia trocam de turno em 01/02/2027');
    expect(descreverPedido({ ...base, tipo: 'troca_turno', payload: { dataSolicitante: '2027-02-01', dataColega: '2027-02-03' } })).toBe('Ana cede o turno de 01/02/2027 e assume o de 03/02/2027 de Bia');
    expect(descreverPedido({ ...base, tipo: 'troca_folga', payload: { folgarEm: '2027-02-04', trabalharEm: '2027-02-06' } })).toBe('Ana folga em 04/02/2027 e trabalha em 06/02/2027');
    expect(descreverPedido({ ...base, tipo: 'ferias', payload: { inicio: '2027-03-01', fim: '2027-03-15' } })).toBe('Ana: férias de 01/03/2027 a 15/03/2027');
    expect(descreverPedido({ ...base, tipo: 'afastamento', payload: { inicio: '2027-03-01', fim: '2027-03-02' } })).toBe('Ana: afastamento de 01/03/2027 a 02/03/2027');
  });
  it('rótulos e estado aberto', () => {
    expect(ROTULO_TIPO.troca_turno).toBe('Troca de turno com colega');
    expect(ROTULO_STATUS.pendente).toBe('Aguardando o RH');
    expect(ABERTA({ status: 'pendente' })).toBe(true);
    expect(ABERTA({ status: 'aguardando_colega' })).toBe(true);
    expect(ABERTA({ status: 'aprovada' })).toBe(false);
    expect(ABERTA({ status: 'cancelada' })).toBe(false);
  });
  it('opções de colega ordenadas por data e nome', () => {
    const o = opcoesColega([
      { colaborador_id: 'b', nome: 'Bia', data: '2027-02-02', inicio_min: 720, fim_min: 1260, intervalo_min: 60 },
      { colaborador_id: 'c', nome: 'Caio', data: '2027-02-01', inicio_min: 480, fim_min: 1020, intervalo_min: 60 },
      { colaborador_id: 'a', nome: 'Ana', data: '2027-02-01', inicio_min: 480, fim_min: 1020, intervalo_min: 60 },
    ]);
    expect(o.map((x) => x.rotulo)).toEqual(['Ana · 01/02/2027 · 08:00–17:00', 'Caio · 01/02/2027 · 08:00–17:00', 'Bia · 02/02/2027 · 12:00–21:00']);
    expect(o[0]).toMatchObject({ valor: 'a|2027-02-01', colaboradorId: 'a', data: '2027-02-01' });
  });
});
