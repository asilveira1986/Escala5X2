export type FormaPagamento = 'pix' | 'boleto' | 'cartao' | 'indefinida';
export type StatusAssinatura = 'teste' | 'aguardando_pagamento' | 'ativa' | 'inadimplente' | 'cancelada';

export type DadosCliente = { nome: string; cnpj: string | null; email: string | null; referencia: string };
export type PedidoAssinatura = { clienteExterno: string; valorCentavos: number; forma: FormaPagamento; primeiroVencimento: string; descricao: string; referencia: string };

/** O que qualquer provedor de pagamento precisa saber fazer. Hoje há o Asaas; outro (Stripe) entra implementando isto. */
export interface ProvedorCobranca {
  readonly nome: string;
  criarCliente(c: DadosCliente): Promise<{ id: string }>;
  criarAssinatura(p: PedidoAssinatura): Promise<{ id: string }>;
  atualizarValor(assinaturaExterna: string, valorCentavos: number): Promise<void>;
  cancelarAssinatura(assinaturaExterna: string): Promise<void>;
}

export type TipoEvento = 'fatura_criada' | 'fatura_paga' | 'fatura_vencida' | 'fatura_estornada' | 'fatura_cancelada' | 'assinatura_cancelada';
/** Evento do provedor já traduzido para o formato do banco (`aplicar_evento_cobranca`). */
export type EventoCobranca = {
  id: string; tipo: TipoEvento;
  dados: { assinaturaExterna: string | null; referencia: string | null; faturaExterna: string | null; valorCentavos: number | null; vencimento: string | null; pagoEm: string | null; forma: FormaPagamento; url: string | null };
};

export class ErroCobranca extends Error {
  constructor(mensagem: string, readonly status?: number) { super(mensagem); this.name = 'ErroCobranca'; }
}
