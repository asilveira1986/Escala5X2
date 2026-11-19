import { Abas } from '@/components/Abas';
import { CabecalhoItem, ResumoItem } from '@/components/ItemTela';
import { Aviso, Cartao, Selo } from '@/components/ui';
import { horasTexto, ROTULO_SITUACAO_BANCO, saldoTexto, situacaoBanco, TOM_SITUACAO_BANCO } from '@/lib/banco-horas-ui';
import { dataBr } from '@jc/rules-engine';
import type { Lancamento, SaldoBanco } from '@jc/servicos';
import { Extrato } from '../Extrato';
import { FormLancamento } from '../FormLancamento';

const iniciais = (nome: string) => { const p = nome.trim().split(/\s+/); return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?'; };

/** Abas da tela: o "Novo lançamento" só existe para quem gere a empresa; "Vencimentos" mostra a quantidade de lotes. */
export const abasBanco = (podeGerir: boolean, lotes: number) => [
  { id: 'extrato', rotulo: 'Extrato' },
  { id: 'vencimentos', rotulo: 'Vencimentos', contagem: lotes },
  ...(podeGerir ? [{ id: 'lancamento', rotulo: 'Novo lançamento' }] : []),
];

/** Tela do banco de horas de uma pessoa: cabeçalho, resumo do saldo e abas (extrato, vencimentos, novo lançamento). */
export function TelaBancoHoras({ empresaId, colaborador, saldo, lancamentos, aba, podeGerir, hoje }: {
  empresaId: string; colaborador: { id: string; nome: string }; saldo: SaldoBanco; lancamentos: Lancamento[]; aba: string; podeGerir: boolean; hoje: string;
}) {
  const situacao = situacaoBanco(lancamentos.length === 0 ? null : saldo);
  const proximo = saldo.proximoVencimento;
  return (
    <>
      <CabecalhoItem iniciais={iniciais(colaborador.nome)} titulo={colaborador.nome} subtitulo="Banco de horas"
        selo={<Selo tom={TOM_SITUACAO_BANCO[situacao]}>{ROTULO_SITUACAO_BANCO[situacao]}</Selo>} />
      <ResumoItem rotulo="Resumo do banco de horas" itens={[
        { rotulo: 'Saldo', valor: <span className={`horario ${saldo.saldoMin < 0 ? 'text-risco-fg' : ''}`}>{saldoTexto(saldo.saldoMin)}</span> },
        { rotulo: 'Vence em 30 dias', valor: <span className={`horario ${saldo.aVencerMin > 0 ? 'text-atencao-fg' : ''}`}>{horasTexto(saldo.aVencerMin)}</span> },
        { rotulo: 'Vencido a pagar', valor: <span className={`horario ${saldo.vencidoMin > 0 ? 'text-risco-fg' : ''}`}>{horasTexto(saldo.vencidoMin)}</span> },
        { rotulo: 'Próximo vencimento', valor: <span className="horario">{proximo ? `${dataBr(proximo.venceEm)} · ${horasTexto(proximo.minutos)}` : '—'}</span> },
      ]} />
      <Abas abas={abasBanco(podeGerir, saldo.lotes.length)} atual={aba} base={`/empresas/${empresaId}/banco-horas/${colaborador.id}`} rotulo="Seções do banco de horas" />

      {aba === 'extrato' ? (
        <Cartao icone="folha" titulo="Extrato" subtitulo="O livro é imutável: se errar, estorne o lançamento (fica registrado quem, quando e por quê).">
          {lancamentos.length === 0 ? <p className="text-sm text-suave">Nenhum lançamento.</p> : <Extrato lancamentos={lancamentos} empresaId={podeGerir ? empresaId : undefined} />}
        </Cartao>
      ) : null}

      {aba === 'vencimentos' ? (
        <Cartao icone="calendario" titulo="Créditos por vencimento" subtitulo="O que ainda não foi compensado, por data de vencimento. Crédito vencido vira hora extra a pagar.">
          {saldo.lotes.length === 0 ? <p className="text-sm text-suave">Nenhum crédito em aberto.</p> : (
            <ul className="divide-y divide-linha text-sm">
              {saldo.lotes.map((l) => (
                <li key={l.venceEm + l.minutos} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>Vence em <span className="horario font-semibold">{dataBr(l.venceEm)}</span>{l.venceEm < hoje ? <> <Selo tom="vermelho">Vencido</Selo></> : null}</span>
                  <span className="horario font-semibold">{horasTexto(l.minutos)}</span>
                </li>
              ))}
            </ul>
          )}
          {saldo.negativoMin > 0 ? <div className="mt-3"><Aviso tipo="info">Saldo negativo permitido pelo acordo: {horasTexto(saldo.negativoMin)}.</Aviso></div> : null}
        </Cartao>
      ) : null}

      {aba === 'lancamento' && podeGerir ? (
        <Cartao icone="mais" titulo="Novo lançamento" subtitulo="Crédito, compensação, falta, ajuste ou pagamento de horas vencidas.">
          <FormLancamento empresaId={empresaId} colaboradorId={colaborador.id} hoje={hoje} vencidoMin={saldo.vencidoMin} />
        </Cartao>
      ) : null}
    </>
  );
}
