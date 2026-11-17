# Cobrança da plataforma (Asaas)

Cada **organização** (cliente do JornadaCerta) tem uma **assinatura**: começa com **14 dias de teste grátis** e depois assina um **plano** mensal, pago por PIX, boleto ou cartão. O provedor de pagamento é o **Asaas**; o código fala com ele por uma interface (`ProvedorCobranca`), então outro (Stripe) entra implementando a mesma interface.

> **Importante:** o Asaas foi integrado a partir da documentação pública e **testado só com simulação** (o ambiente de desenvolvimento não alcança o Asaas). **Valide tudo no sandbox** (https://sandbox.asaas.com) antes de cobrar de verdade: criar assinatura, pagar a primeira fatura no sandbox, ver a fatura mudar para "Paga" e a assinatura para "Ativa".

## O que o cliente vê
**Configurações › Plano e cobrança** (`/cobranca`, só o **administrador** da organização): situação da assinatura, planos com preço, botão **Assinar** (escolhendo PIX, boleto, cartão ou "escolher na hora"), **Trocar para este plano**, **Cancelar assinatura** (com confirmação) e a lista de **faturas** com link para pagar. Uma faixa no topo avisa quando o teste está acabando ou há fatura vencida. O administrador também recebe **notificações** de pagamento confirmado, fatura vencida e estorno.

## Como o dinheiro entra
1. O admin escolhe um plano: o servidor cria o cliente e a **assinatura mensal** no Asaas (primeira cobrança no fim do teste, ou amanhã).
2. O Asaas gera as faturas e avisa por **webhook** (`POST /api/webhooks/asaas`, autenticado pelo cabeçalho `asaas-access-token`).
3. O webhook vira um evento normalizado e `aplicar_evento_cobranca` (banco) atualiza a fatura e a assinatura: pago → **ativa**; vencido → **inadimplente**; estorno; cancelamento. É **idempotente** (o mesmo evento não se aplica duas vezes) e tolerante a ordem (aviso atrasado de "em aberto" não desfaz um "pago").

## Bloqueio por falta de pagamento (desligado por padrão)
Com `COBRANCA_ATIVA=1`, a **gestão** da organização é bloqueada (só a tela de Plano e cobrança continua) quando: o teste venceu sem assinatura; a assinatura foi cancelada; ou há fatura vencida há mais de **7 dias** (carência). Colaboradores que só consultam a própria escala **não** são bloqueados. Sem a variável, o sistema só mostra avisos. Passar do limite de colaboradores do plano só gera aviso.

## Para ligar (passo a passo)
1. Rodar no SQL Editor do Supabase, uma vez: `packages/db/setup/supabase_atualizar_cobranca.sql` (depois dos instaladores anteriores). Ele cria os planos de **exemplo** e dá 14 dias de teste a todas as organizações existentes.
2. **Ajustar os planos** (os valores são exemplo, não uma decisão minha): `update plano set preco_centavos = 19900, limite_colaboradores = 30 where codigo = 'inicial';` (idem `profissional` e `empresarial`).
3. No Asaas (sandbox primeiro): criar a conta, gerar a **chave de API** e configurar um **webhook** para `https://SEU-DOMINIO/api/webhooks/asaas` com um **token** à sua escolha, marcando os eventos de cobrança (PAYMENT_*) e de assinatura (SUBSCRIPTION_*).
4. No serviço **web** do Railway, definir: `ASAAS_API_KEY`, `ASAAS_AMBIENTE` (`sandbox` ou `producao`), `ASAAS_WEBHOOK_TOKEN` (o mesmo do passo 3). `SUPABASE_SERVICE_ROLE_KEY` também é necessária (já usada para publicar escalas).
5. Testar no sandbox; só então trocar para `producao` e, quando quiser cobrar de verdade, definir `COBRANCA_ATIVA=1`.

Nunca coloque a chave do Asaas no código, no chat ou no navegador: ela só existe como variável do servidor.

## Limites desta etapa
- Preço por faixa de colaboradores ativos (sem cobrança variável por uso); o plano muda o valor das **próximas** faturas.
- Sem emissão de nota fiscal (o Asaas tem recurso próprio para isso) e sem cupom/desconto.
- Cancelar encerra o acesso da gestão na hora (não espera o fim do ciclo já pago).
- Uma organização por administrador na tela (quem administra várias vê a primeira).
