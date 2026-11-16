# Fase 2 — Escalas (andamento)

## Já pronto
- **Motor de validação** (`@jc/rules-engine`): `validarEscala` e `calcularHoras`. Bloqueio, alerta ou informação por turno; leva em conta a virada de fase da lei (15/12/2026 e 15/12/2027), acordos coletivos (12x36, rodízio de domingo), férias, feriados e cobertura.
- **Banco** (migrations 0006 a 0008): turnos-modelo, demanda de cobertura, ausências, escala, alocação, violação, ciência. Escala publicada é imutável; publicar só pelo servidor; gravação da grade com trava de revisão.
- **Serviços** (`@jc/servicos`): validar, resumir horas, publicar, registrar ciência.
- **Editor** (`/empresas/:id/escalas`): grade pessoa × dia, pincel de turnos, validação ao vivo, avisos clicáveis, publicação com ciência dos alertas, nova versão a partir de uma publicada.

- **Minha escala** (`/minha-escala`): o colaborador vê o próximo turno, o calendário e o dia a dia das escalas publicadas, e confirma a ciência (fica registrada com data, hora e o código de verificação da escala). Quem só tem papel de colaborador ou líder entra direto nessa tela; gestores que também são colaboradores ganham o atalho no topo.

- **Cobertura mínima** (`/empresas/:id/escalas/cobertura`): faixas por dia da semana (várias de uma vez), com mínimo e ideal, para a empresa toda ou por setor; aceita faixa que vira a noite. O editor destaca os dias abaixo do mínimo.
- **Férias e afastamentos** (`/empresas/:id/escalas/ausencias`): lançamento por colaborador e período (sem sobreposição). Aparecem na grade como "Fér"/"Afa" e escalar trabalho nesses dias impede a publicação.

## Para publicar escalas no seu ambiente
1. Rode `packages/db/setup/supabase_atualizar_escalas.sql` no SQL Editor do Supabase (uma vez; contém as migrations 0006 a 0008).
2. No serviço **web** do Railway, adicione a variável `SUPABASE_SERVICE_ROLE_KEY` (chave *secret* do Supabase, Settings → API Keys). Sem prefixo `NEXT_PUBLIC_`; nunca no navegador. Sem ela, o botão Publicar avisa que a publicação não está habilitada. Salvar rascunhos funciona sem ela.

## Ainda não feito (próximas etapas)

- Painel da carteira contábil; importação AFD.
- Prorrogação do trabalho noturno (depende de definição jurídica).

## Convite do colaborador (migration 0009)
Na aba **Equipe**, a coluna "Acesso ao app" permite **Convidar** (informando o e-mail), **Reenviar**, **Cancelar** o convite e **Remover** o acesso. A pessoa abre o link do e-mail e passa a ver "Minha escala". O vínculo só acontece com o e-mail **confirmado** (link, Google): digitar o e-mail de outra pessoa não dá acesso ao cadastro. Convites valem 14 dias. Quem já tem outro papel (RH, admin) não é rebaixado.

### Configuração única no Supabase (Authentication)
1. **Modelos de e-mail** (Authentication → Emails → Templates): nos modelos **Magic Link** e **Confirm signup**, troque o link por
   `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email`
   (isso faz o link funcionar em qualquer aparelho; o convite é enviado de um navegador e aberto em outro).
2. **URL Configuration**: Site URL = endereço do app no Railway; em Redirect URLs inclua `<endereço do app>/auth/confirmar` e `<endereço do app>/auth/callback`.
3. **Envio de e-mail**: o envio padrão do Supabase é limitado a poucos e-mails por hora. Para uso real, configure um SMTP próprio (Authentication → Emails → SMTP Settings; Resend, SendGrid etc.).
4. No Railway (serviço web), confira `NEXT_PUBLIC_APP_URL` com o endereço real do app (é usado no link do convite).

### Ativação no banco
Rode `packages/db/setup/supabase_atualizar_convite.sql` (uma vez) depois dos arquivos das escalas.

### Ativação (cobertura)
Rode `packages/db/setup/supabase_atualizar_cobertura.sql` (uma vez): valida que a demanda de um setor pertence à empresa.
