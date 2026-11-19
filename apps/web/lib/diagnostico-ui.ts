export type TomSituacao = 'cinza' | 'verde' | 'amarelo';

/** Situação do diagnóstico: quantas pessoas ainda precisam de adequação (`null` = diagnóstico sem resumo). */
export function situacaoDiagnostico(aAdequar: number | null): { tom: TomSituacao; rotulo: string } {
  if (aAdequar === null) return { tom: 'cinza', rotulo: 'Sem resumo' };
  return aAdequar === 0 ? { tom: 'verde', rotulo: 'Tudo adequado' } : { tom: 'amarelo', rotulo: `${aAdequar} a adequar` };
}
