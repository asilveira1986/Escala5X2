# Fase 2 — Escalas (andamento)

## Já pronto
- **Motor de validação** (`@jc/rules-engine`): `validarEscala` e `calcularHoras`. Bloqueio, alerta ou informação por turno; leva em conta a virada de fase da lei (15/12/2026 e 15/12/2027), acordos coletivos (12x36, rodízio de domingo), férias, feriados e cobertura.
- **Banco** (migrations 0006 a 0008): turnos-modelo, demanda de cobertura, ausências, escala, alocação, violação, ciência. Escala publicada é imutável; publicar só pelo servidor; gravação da grade com trava de revisão.
- **Serviços** (`@jc/servicos`): validar, resumir horas, publicar, registrar ciência.
- **Editor** (`/empresas/:id/escalas`): grade pessoa × dia, pincel de turnos, validação ao vivo, avisos clicáveis, publicação com ciência dos alertas, nova versão a partir de uma publicada.

## Para publicar escalas no seu ambiente
1. Rode `packages/db/setup/supabase_atualizar_escalas.sql` no SQL Editor do Supabase (uma vez; contém as migrations 0006 a 0008).
2. No serviço **web** do Railway, adicione a variável `SUPABASE_SERVICE_ROLE_KEY` (chave *secret* do Supabase, Settings → API Keys). Sem prefixo `NEXT_PUBLIC_`; nunca no navegador. Sem ela, o botão Publicar avisa que a publicação não está habilitada. Salvar rascunhos funciona sem ela.

## Ainda não feito (próximas etapas)
- "Minha escala" do colaborador e botão de ciência; convite por e-mail.
- Cadastro de demanda de cobertura e de ausências pela tela (hoje só no banco).
- Painel da carteira contábil; importação AFD.
- Prorrogação do trabalho noturno (depende de definição jurídica).
