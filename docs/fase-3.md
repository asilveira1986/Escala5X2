# Fase 3 — Automação (andamento)

## Otimizador (PRs #16 e #17)
Veja `docs/otimizador.md`.

## Solicitações e trocas
O colaborador (com acesso ao app) pede em **Minha escala → Pedir troca, folga ou férias**:
- **Troca de turno com colega**: escolhe o seu turno e o de um colega (da mesma escala publicada, com acesso ao app). O colega aceita ou recusa; só depois o pedido vai ao RH.
- **Troca de folga**: folga num dia em que trabalharia e trabalha num dia de folga.
- **Férias** e **afastamento (atestado)**: período e motivo.
O colaborador acompanha e pode cancelar enquanto aberto.

O RH decide em **Pedidos** (aba da empresa): antes de aprovar, o sistema mostra o que a mudança faz e **só o que ela introduz de problema** (o que já estava errado antes não é atribuído ao pedido) com o mesmo motor que valida a publicação. Violação de bloqueio impede a aprovação (o RH pode recusar com motivo).

Efeito da aprovação:
- **Troca (turno ou folga)**: escala publicada é imutável, então nasce uma **nova versão** com a troca, publicada na hora (hash novo; a anterior fica "substituída"). Os colaboradores dão ciência da nova versão. Pedidos feitos sobre a versão antiga são aplicados na versão vigente. Precisa de `SUPABASE_SERVICE_ROLE_KEY` no serviço web (a mesma da publicação).
- **Férias/afastamento**: a ausência é lançada na mesma transação da decisão; se houver turnos já escalados no período, o RH é avisado para reorganizar.

Regras do banco: só o próprio colaborador pede por si; só pedidos de hoje em diante (afastamento: até 30 dias depois do início); no máximo 10 pedidos em aberto por pessoa; pedido idêntico em aberto não se repete; toda mudança de estado é auditada.

### Ativação
Rodar `packages/db/setup/supabase_atualizar_solicitacoes.sql` (uma vez). Ele também atualiza `escala_entrada` para trazer o modelo de turno de cada alocação.

### Ainda não feito (próximas fatias)
Notificações (e-mail/WhatsApp) de pedido novo e de decisão; ciência apenas dos afetados em versões geradas por troca; ajuste de ponto; banco de horas; PWA; exportação para folha; WhatsApp; cobrança.
