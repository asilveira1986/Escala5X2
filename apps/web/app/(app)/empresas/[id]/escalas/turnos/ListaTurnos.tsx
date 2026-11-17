'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { Aviso, Botao, Campo, classeCampo } from '@/components/ui';
import { horaDeMinutos } from '@/lib/adequador-ui';
import { duracao, hhmm } from '@jc/rules-engine';
import { arquivarModelo, editarModelo } from '../actions';

export type TurnoLista = { id: string; nome: string; inicio_min: number; fim_min: number; intervalo_min: number };

/** Lista de turnos com edição no próprio lugar e remoção (arquivamento) com confirmação. */
export function ListaTurnos({ empresaId, turnos }: { empresaId: string; turnos: TurnoLista[] }) {
  const [editando, setEditando] = useState<string | null>(null);
  return (
    <ul className="space-y-2">
      {turnos.map((t) => (
        <li key={t.id} className="rounded-2xl border border-linha bg-fundo px-3.5 py-2.5">
          {editando === t.id
            ? <FormEdicao empresaId={empresaId} turno={t} aoFechar={() => setEditando(null)} />
            : <LinhaTurno empresaId={empresaId} turno={t} aoEditar={() => setEditando(t.id)} />}
        </li>
      ))}
    </ul>
  );
}

function LinhaTurno({ empresaId, turno: t, aoEditar }: { empresaId: string; turno: TurnoLista; aoEditar: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const remover = () => iniciar(async () => { const r = await arquivarModelo(empresaId, t.id); if (!r.ok) { setErro(r.erro); setConfirmando(false); } });
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{t.nome}</span>
        <span className="text-sm">{hhmm(t.inicio_min)}–{hhmm(t.fim_min)}</span>
        <span className="text-sm text-suave">intervalo {t.intervalo_min} min · {duracao(t.fim_min - t.inicio_min - t.intervalo_min)} líquidas</span>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={aoEditar} aria-label={`Editar o turno ${t.nome}`} className="rounded-full px-3 py-1.5 text-sm font-semibold text-marca hover:bg-marca-suave">Editar</button>
          {!confirmando ? <button type="button" onClick={() => setConfirmando(true)} aria-label={`Remover o turno ${t.nome}`} className="rounded-full px-3 py-1.5 text-sm font-semibold text-risco-fg hover:bg-risco-bg">Remover</button> : null}
        </span>
      </div>
      {confirmando ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-risco-bg px-3 py-2 text-sm text-risco-fg">
          <span>Remover <strong>{t.nome}</strong> da lista? As escalas que já o usaram não mudam.</span>
          <Botao variante="perigo" disabled={pendente} onClick={remover}>{pendente ? 'Removendo…' : 'Confirmar remoção'}</Botao>
          <Botao variante="secundario" disabled={pendente} onClick={() => setConfirmando(false)}>Cancelar</Botao>
        </div>
      ) : null}
      {erro ? <div className="mt-2"><Aviso tipo="erro">{erro}</Aviso></div> : null}
    </div>
  );
}

function FormEdicao({ empresaId, turno: t, aoFechar }: { empresaId: string; turno: TurnoLista; aoFechar: () => void }) {
  const [estado, acao, pendente] = useActionState(editarModelo, {});
  useEffect(() => { if (estado.ok) aoFechar(); }, [estado.ok, aoFechar]);
  return (
    <form action={acao} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="empresaId" value={empresaId} />
      <input type="hidden" name="modeloId" value={t.id} />
      <Campo rotulo="Nome"><input name="nome" required maxLength={40} defaultValue={t.nome} className={`${classeCampo} sm:w-36`} /></Campo>
      <Campo rotulo="Entrada"><input type="time" name="inicio" defaultValue={horaDeMinutos(t.inicio_min)} required className={classeCampo} /></Campo>
      <Campo rotulo="Saída" dica="Antes da entrada = dia seguinte."><input type="time" name="fim" defaultValue={horaDeMinutos(t.fim_min)} required className={classeCampo} /></Campo>
      <Campo rotulo="Intervalo (min)"><input type="number" name="intervalo" min={0} max={240} defaultValue={t.intervalo_min} className={`${classeCampo} sm:w-28`} /></Campo>
      <Botao disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar'}</Botao>
      <Botao type="button" variante="secundario" disabled={pendente} onClick={aoFechar}>Cancelar</Botao>
      <p className="basis-full text-xs text-suave">A mudança vale para as próximas escalas e adequações. O que já foi escalado, inclusive escalas publicadas, não muda.</p>
      {estado.erro ? <div className="basis-full"><Aviso tipo="erro">{estado.erro}</Aviso></div> : null}
    </form>
  );
}
