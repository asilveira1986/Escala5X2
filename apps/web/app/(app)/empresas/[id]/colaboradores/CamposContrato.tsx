'use client';

import { useState } from 'react';
import { Campo, classeCampo } from '@/components/ui';

export type ErrosContrato = Partial<Record<'salario' | 'jornada_semanal' | 'tipo_escala' | 'divisor' | 'horas_extras_mensais' | 'folgas_semana', string>>;

/** Campos do contrato (salário, jornada, escala...), iguais no cadastro e na mudança de contrato. */
export function CamposContrato({ valores, erros }: { valores?: Record<string, string>; erros?: ErrosContrato }) {
  const v = (c: string) => valores?.[c] ?? '';
  const [tipo, setTipo] = useState(valores?.tipo_escala || '5x2');
  const erro = (c: keyof ErrosContrato) => (erros?.[c] ? <span role="alert" className="mt-1 block text-xs text-risco-fg">{erros[c]}</span> : null);
  return (
    <>
      <Campo rotulo="Salário base (R$) *"><input name="salario" required inputMode="decimal" placeholder="2.500,00" defaultValue={v('salario')} className={classeCampo} />{erro('salario')}</Campo>
      <Campo rotulo="Jornada semanal (horas) *" dica="Ex.: 44 ou 40"><input name="jornada_semanal" required inputMode="decimal" defaultValue={v('jornada_semanal') || '44'} className={classeCampo} />{erro('jornada_semanal')}</Campo>
      <Campo rotulo="Tipo de escala *">
        <select name="tipo_escala" value={tipo} onChange={(e) => setTipo(e.target.value)} className={classeCampo}>
          <option value="5x2">5x2 (5 dias de trabalho, 2 de folga)</option><option value="6x1">6x1</option><option value="12x36">12x36</option><option value="personalizada">Personalizada</option>
        </select>
        {erro('tipo_escala')}
      </Campo>
      <Campo rotulo="Turno" dica="Ex.: Manhã, Noite"><input name="turno" defaultValue={v('turno')} className={classeCampo} /></Campo>
      <Campo rotulo="Divisor da hora" dica="Em branco: calculado pela jornada"><input name="divisor" inputMode="numeric" defaultValue={v('divisor')} className={classeCampo} />{erro('divisor')}</Campo>
      <Campo rotulo="Horas extras por mês" dica="Média habitual, em horas (opcional)"><input name="horas_extras_mensais" inputMode="decimal" defaultValue={v('horas_extras_mensais')} className={classeCampo} />{erro('horas_extras_mensais')}</Campo>
      {tipo === 'personalizada' ? <Campo rotulo="Folgas por semana"><input name="folgas_semana" inputMode="numeric" defaultValue={v('folgas_semana')} className={classeCampo} />{erro('folgas_semana')}</Campo> : null}

    </>
  );
}
