# Notificações dentro do sistema

O **sino** na barra de cima mostra quantas notificações não foram lidas, abre a lista ao clicar (com "Marcar todas como lidas" e "Ver todas") e atualiza o número sozinho a cada minuto e ao voltar para a aba. A página `/notificacoes` guarda as 100 mais recentes.

## Quem é avisado e quando

| Evento | Quem recebe |
|---|---|
| Pedido de **troca de turno** criado | o colega indicado |
| Pedido que vai direto ao RH (férias, afastamento, troca de folga) | a gestão da empresa |
| Colega **aceita** a troca | a pessoa que pediu e a gestão |
| Colega **recusa** | a pessoa que pediu |
| RH **aprova** ou **recusa** | a pessoa que pediu (com o motivo) e, na troca aprovada, o colega |
| Pedido **cancelado** enquanto aguarda o colega | o colega |
| **Banco de horas vencendo** (job diário) | o colaborador (a vencer em até 30 dias, 1× por semana; vencido, 1× por mês) e a gestão (resumo semanal) |
| **Escala publicada** (inclui nova versão após troca aprovada) | quem está na escala e tem acesso ao sistema |

"Gestão" é a mesma regra de `pode_gerir_empresa`: admin e RH da organização e admin/contador vinculados à empresa. Líder não recebe pedidos para decidir.

## Como funciona (migration 0020)

- Tabela `notificacao` (uma linha por pessoa e aviso). Os avisos nascem em **gatilhos** das tabelas `solicitacao` e `escala`, então nenhum caminho de código esquece de avisar.
- Cada pessoa só vê as próprias (RLS) e só pode **marcar como lida** (uma vez; ninguém apaga nem edita o conteúdo).
- Os links são só caminhos internos (`hrefSeguro`).
- API: `GET /api/v1/notificacoes` (lista e contagem; `?contagem=1` só o número) e `POST /api/v1/notificacoes/lidas` (com `{ids:[...]}` ou vazio para todas; só aceita a própria origem).
- Se o SQL ainda não foi aplicado, o sino aparece sem número e a lista mostra "não foi possível carregar": o resto do sistema não é afetado.

Instalador incremental: `packages/db/setup/supabase_atualizar_notificacoes.sql`.

## Aviso de vencimento do banco de horas (migration 0021)

Todo dia às **8h (Brasília)** o worker (`jobs/src/avisar-vencimento-banco.ts`, agendado pelo pg-boss) calcula o saldo de cada colaborador com a mesma conta da tela do banco de horas (créditos consumidos do mais próximo de vencer para o mais distante) e chama `avisar_vencimento_banco`:

- **Colaborador com acesso:** "Banco de horas: 2h30 vencem em breve" (crédito que vence nos próximos 30 dias, com a data do mais próximo) — um aviso por semana enquanto houver; e "1h vencidas" (pagas como hora extra) — um por mês enquanto houver.
- **Gestão:** um resumo por semana ("3 colaboradores com horas vencendo ou vencidas; 5h vencem em até 30 dias; 2h já vencidas"), com link para o banco de horas.
- **Desligados:** não recebem aviso de "a vencer" (não há o que compensar); o vencido continua contando no resumo da gestão (a pagar na rescisão).
- **Sem repetição:** cada aviso tem uma *chave* (colaborador + semana/mês); rodar duas vezes no mesmo dia não duplica. A compensação lançada no banco tira o crédito do aviso na execução seguinte.
- Uma empresa com erro não impede as demais; o job consta como falho e roda de novo no dia seguinte. O log do worker mostra `[aviso-banco] N empresa(s), N colaborador(es), N aviso(s) novo(s)`.

Instalador incremental: `packages/db/setup/supabase_atualizar_aviso_banco.sql` (exige o das notificações antes).
