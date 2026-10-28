'use client';

import { useActionState, useState } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { ROTULO_CENARIO } from '@jc/documents/formatar';
import { simularCenario, type EstadoSimulacao } from './actions';

type Tipo = keyof typeof ROTULO_CENARIO;

export function Simulador({ diagnosticoId, empresaId }: { diagnosticoId: string; empresaId: string }) {
  const [estado, acao, pendente] = useActionState<EstadoSimulacao, FormData>(simularCenario, {});
  const [tipo, setTipo] = useState<Tipo>('horas_extras');
  const num = (nome: string, rotulo: string, padrao: number, dica?: string, extra: { min?: number; max?: number; step?: number } = {}) => (
    <Campo rotulo={rotulo} dica={dica}><input name={nome} type="number" inputMode="decimal" defaultValue={padrao} step={extra.step ?? 'any'} min={extra.min} max={extra.max} required className={classeCampo} /></Campo>
  );
  return (
    <form action={acao} className="space-y-3">
      <input type="hidden" name="diagnosticoId" value={diagnosticoId} />
      <input type="hidden" name="empresaId" value={empresaId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Cenário">
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={classeCampo}>
            {Object.entries(ROTULO_CENARIO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Fase da lei"><select name="fase" defaultValue="F2" className={classeCampo}><option value="F1">Fase 1 (42h)</option><option value="F2">Fase 2 (40h)</option></select></Campo>
        <Campo rotulo="Nome (opcional)"><input name="nome" maxLength={80} className={classeCampo} /></Campo>
        {num('encargosPct', 'Encargos (%)', 0, 'Sobre folha e horas extras. Informe o seu percentual.', { min: 0, max: 200 })}
        {num('adicionalHePct', 'Adicional de hora extra (%)', 50, 'Mínimo legal de 50%, ou o do acordo.', { min: 50, max: 300 })}
        <input type="hidden" name="ajusteSalarialPct" value="0" />
        {tipo === 'contratar' && num('custoContratacaoReais', 'Custo por contratação (R$)', 0, 'Recrutamento e treinamento, valor único.', { min: 0 })}
        {tipo === 'reorganizar_turnos' && num('absorcaoPct', 'Déficit absorvido sem custo (%)', 0, 'Parte resolvida só reorganizando turnos.', { min: 0, max: 100 })}
        {tipo === 'acordo_compensatorio' && num('custoAdicionalFolhaPct', 'Custo adicional sobre a folha (%)', 0, 'Ex.: adicional noturno em escala 12x36.', { min: 0, max: 100 })}
      </div>
      {tipo !== 'contratar' && <input type="hidden" name="custoContratacaoReais" value="0" />}
      {tipo !== 'reorganizar_turnos' && <input type="hidden" name="absorcaoPct" value="0" />}
      {tipo !== 'acordo_compensatorio' && <input type="hidden" name="custoAdicionalFolhaPct" value="0" />}
      {estado.erro ? <Aviso tipo="erro">{estado.erro}</Aviso> : null}
      {estado.resultado?.bloqueado ? <Aviso tipo="erro">{estado.resultado.alertas[0]}</Aviso> : null}
      <Botao disabled={pendente}>{pendente ? 'Simulando…' : 'Simular e salvar cenário'}</Botao>
    </form>
  );
}
