import type { ReactNode } from 'react';
import { IlustracaoVazia } from './icones';

export function EstadoVazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-4 text-center">
      <IlustracaoVazia />
      <p className="text-base font-bold">{titulo}</p>
      {children ? <div className="max-w-md text-sm text-suave">{children}</div> : null}
    </div>
  );
}
