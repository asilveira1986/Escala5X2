# Dados fictícios para teste

Cria uma organização à parte, **"Demo JornadaCerta"**, com tudo inventado, para você exercitar o sistema sem usar dados de cliente.

## O que é criado
- Empresa **Padaria Estrela Demo Ltda** (CNPJ fictício, porte ME, São Paulo), unidade Loja Centro e setores **Atendimento** e **Cozinha**.
- 3 turnos (Manhã 08:00–17:00, Tarde 10:00–19:00, Madrugada 05:00–14:00), todos com 1 h de intervalo.
- **8 colaboradores** (Ana Souza Demo, Bruno Lima Demo, Carla Mendes Demo, …) com CPF fictício, contrato 5x2 de 40 h e salários diferentes.
- Cobertura mínima de segunda a sábado (Atendimento 2 a 3 pessoas; Cozinha 1 a 2).
- Férias fictícias da Carla na segunda quinzena do mês que vem.
- Uma **escala em rascunho do mês que vem** (domingo fechado, cada pessoa com uma folga fixa na semana). Ela não tem bloqueios, então dá para **publicar** e testar o fluxo inteiro (ciência, histórico, pedidos).

## Como usar
1. Supabase → **SQL Editor** → cole `packages/db/setup/supabase_dados_de_teste.sql` → **Run**. Pode rodar de novo: se a organização demo já existe, nada é duplicado.
2. Entre no sistema com o seu usuário: ele vira **administrador** da organização demo (por padrão, o usuário mais antigo do sistema; para escolher outro, troque `v_email_admin` no começo do script).
3. **App do colaborador:** crie outro usuário em *Authentication → Users*, coloque o e-mail dele em `v_email_colaborador` no começo do script e rode (ou rode o script uma vez, apague a demo com o script de remoção, preencha e rode de novo). Esse usuário passa a ser a "Ana Souza Demo" e vê **Minha escala**, **Meus pedidos** e o resto assim que você publicar a escala.

## Apagar
Rode `packages/db/setup/supabase_remover_dados_de_teste.sql`. Ele só apaga a organização "Demo JornadaCerta" e o que pertence a ela.

## Cuidados
- Os arquivos em `packages/db/setup/` são cópias de `packages/db/seeds/` (geradas por `scripts/gerar-setup-supabase.sh`).
- O script confere, nos testes automáticos, que cria tudo certo, não duplica, e que a escala passa na validação e publica.
- Se o banco for de produção com clientes reais, a organização demo fica visível só para quem é membro dela, mas apague-a ao terminar.
