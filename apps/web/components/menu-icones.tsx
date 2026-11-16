import type { ComponentType, SVGProps } from 'react';
import type { IconeId } from '@/lib/menu';
import {
  IconeBanco, IconeCalendario, IconeCarteira, IconeCobertura, IconeEmpresa, IconeEnviar, IconeFerias, IconeFolha, IconeGrafico, IconeInicio,
  IconePedidos, IconePessoas, IconeRelogio, IconeTurnos,
} from './icones';

type Icone = ComponentType<SVGProps<SVGSVGElement>>;
/** Nome do ícone (lib/menu) → desenho. */
export const ICONES_MENU: Record<IconeId, Icone> = {
  inicio: IconeInicio, carteira: IconeCarteira, empresas: IconeEmpresa, diagnostico: IconeGrafico, equipe: IconePessoas, pessoas: IconePessoas,
  importar: IconeEnviar, escalas: IconeCalendario, calendario: IconeCalendario, turnos: IconeTurnos, cobertura: IconeCobertura, ferias: IconeFerias,
  pedidos: IconePedidos, ponto: IconeRelogio, relogio: IconeRelogio, banco: IconeBanco, folha: IconeFolha, 'minha-escala': IconeCalendario,
};
