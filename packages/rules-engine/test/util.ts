import type { AcordoDoColaborador, ContextoColaborador } from '../src';

export function colab(parcial: Partial<ContextoColaborador> = {}): ContextoColaborador {
  return {
    colaboradorId: 'c1', nome: 'Maria', setor: 'Loja', turno: 'Manhã',
    empresa: { porte: 'medio', terceirizadaPublica: false },
    escolaridade: 'medio', salarioBaseCentavos: 220_000,
    jornadaSemanalMin: 2640, divisorContrato: 220, tipoEscala: '6x1', acordos: [],
    ...parcial,
  };
}

export function acordo(inicio: string | null, fim: string | null, clausulas: AcordoDoColaborador['clausulas'], status: AcordoDoColaborador['status'] = 'vigente'): AcordoDoColaborador {
  return { id: 'ac1', vigencia: { inicio, fim }, status, clausulas };
}
