'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buscarCbo, formatarCbo, type OcupacaoCbo } from '@/lib/cbo';
import { classeCampo } from './ui';

/**
 * Escolha da ocupação (CBO): digite o código ou parte do nome e escolha na lista.
 * Envia no formulário só o código (campo `name`); `aoEscolher` deixa a tela preencher o cargo.
 */
export function SeletorCbo({ name = 'cbo', valorInicial = '', aoEscolher }: { name?: string; valorInicial?: string; aoEscolher?: (o: OcupacaoCbo) => void }) {
  const id = useId();
  const [lista, setLista] = useState<readonly OcupacaoCbo[]>([]);
  const [texto, setTexto] = useState('');
  const [codigo, setCodigo] = useState(formatarCbo(valorInicial) ?? '');
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  // a lista (~110 KB) só é baixada quando o formulário aparece, não no resto do sistema
  useEffect(() => {
    let vivo = true;
    import('@/lib/cbo-dados.json').then((m) => { if (vivo && Array.isArray(m.default)) setLista(m.default as unknown as OcupacaoCbo[]); }).catch(() => { /* sem a lista o campo só não sugere: o cadastro segue sem CBO */ });
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    if (codigo && lista.length > 0) { const o = lista.find(([c]) => c === codigo); if (o) setTexto((t) => t || `${o[0]} · ${o[1]}`); }
  }, [codigo, lista]);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const opcoes = useMemo(() => (aberto ? buscarCbo(lista, texto.replace(/^\d{4}-\d{2} · /, '')) : []), [aberto, lista, texto]);
  const escolher = (o: OcupacaoCbo) => { setCodigo(o[0]); setTexto(`${o[0]} · ${o[1]}`); setAberto(false); aoEscolher?.(o); };
  const limpar = () => { setCodigo(''); setTexto(''); setAberto(false); };

  return (
    <div ref={caixa} className="relative">
      <input type="hidden" name={name} value={codigo} />
      <input
        type="text" role="combobox" aria-expanded={aberto && opcoes.length > 0} aria-controls={`${id}-lista`} aria-autocomplete="list"
        aria-activedescendant={aberto && opcoes[ativo] ? `${id}-${ativo}` : undefined} aria-label="Ocupação (CBO)" autoComplete="off"
        placeholder="Digite o código ou o nome da ocupação" className={classeCampo} value={texto}
        onChange={(e) => { setTexto(e.target.value); setCodigo(''); setAberto(true); setAtivo(0); }}
        onFocus={() => { if (!codigo) setAberto(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo((a) => Math.min(a + 1, Math.max(opcoes.length - 1, 0))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && aberto && opcoes[ativo]) { e.preventDefault(); escolher(opcoes[ativo]!); }
          else if (e.key === 'Escape') setAberto(false);
        }}
      />
      {codigo ? <button type="button" onClick={limpar} aria-label="Limpar a ocupação" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-suave hover:bg-fundo">×</button> : null}
      {aberto && texto.trim() ? (
        <ul id={`${id}-lista`} role="listbox" aria-label="Ocupações encontradas" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-linha bg-cartao p-1 shadow-xl">
          {opcoes.length === 0 ? <li role="presentation" className="px-3 py-2 text-sm text-suave">{lista.length === 0 ? 'Carregando…' : 'Nenhuma ocupação encontrada.'}</li> : opcoes.map((o, i) => (
            <li key={o[0]} id={`${id}-${i}`} role="option" aria-selected={i === ativo} onMouseDown={(e) => { e.preventDefault(); escolher(o); }} onMouseEnter={() => setAtivo(i)}
              className={`cursor-pointer rounded-xl px-3 py-2 text-sm ${i === ativo ? 'bg-marca-suave text-marca' : ''}`}>
              <span className="font-semibold tabular-nums">{o[0]}</span> <span>{o[1]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
