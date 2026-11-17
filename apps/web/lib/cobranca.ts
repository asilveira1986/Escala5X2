import { AsaasProvedor, type ProvedorCobranca } from '@jc/servicos';

/**
 * Configuração da cobrança, por variáveis de ambiente do servidor (nunca no navegador):
 *  ASAAS_API_KEY        chave da API do Asaas (sandbox ou produção)
 *  ASAAS_AMBIENTE       "sandbox" (padrão) ou "producao"
 *  ASAAS_WEBHOOK_TOKEN  segredo que o Asaas manda no cabeçalho do webhook
 *  COBRANCA_ATIVA       "1" liga o bloqueio por falta de pagamento (sem isso o sistema só mostra avisos)
 */
export const cobrancaAtiva = (): boolean => process.env.COBRANCA_ATIVA === '1';

export function provedorDeCobranca(): ProvedorCobranca | null {
  const chave = process.env.ASAAS_API_KEY;
  if (!chave) return null;
  return new AsaasProvedor({ chave, ambiente: process.env.ASAAS_AMBIENTE === 'producao' ? 'producao' : 'sandbox' });
}

export const tokenDoWebhook = (): string | null => process.env.ASAAS_WEBHOOK_TOKEN || null;

export const moeda = (centavos: number): string => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const ROTULO_FORMA = { pix: 'PIX', boleto: 'Boleto', cartao: 'Cartão', indefinida: 'A escolher' } as const;
export const ROTULO_FATURA = { pendente: 'Em aberto', paga: 'Paga', vencida: 'Vencida', estornada: 'Estornada', cancelada: 'Cancelada' } as const;
