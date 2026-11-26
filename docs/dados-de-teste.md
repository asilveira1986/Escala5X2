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

## Supermercado (60 colaboradores)
`packages/db/setup/supabase_dados_supermercado.sql` cria a organização **Demo Supermercado** (Supermercado Bom Preço Demo Ltda), com o mesmo modo de uso acima:
- **60 colaboradores** em 6 setores: Açougue 8, Fruteira 6, Padaria 8, Repositores 12, Caixas 18 e Empacotadores 8 (contrato 5x2 de 40 h).
- **Funcionamento:** segunda a sábado das 8h às 21h; domingo das 8h às 12h e das 16h às 21h. A cobertura mínima de cada setor segue essas faixas (segunda a sábado em três faixas: manhã, meio do dia e noite; domingo só nas duas janelas abertas).
- **Turnos:** Abertura 07h–16h, Abertura padaria 06h–15h, Manhã 08h–17h, Fechamento 12h–21h, Domingo manhã 08h–12h e Domingo tarde 16h–21h.
- **Escala em rascunho do mês que vem** com rodízio de domingo (um sim, um não; a abertura trabalha 8h–12h e o fechamento 16h–21h) e 3 pessoas de férias. Passa na validação da lei sem bloqueios, então dá para publicar. Os únicos alertas são de trabalho em feriado (normal em supermercado) e é preciso marcar "li os alertas" para publicar.
- Também dá para apagar o rascunho e testar as **propostas automáticas** do sistema com essa mesma equipe e cobertura.

## Apagar
Rode `packages/db/setup/supabase_remover_dados_de_teste.sql`. Ele só apaga as organizações "Demo JornadaCerta" e "Demo Supermercado" e o que pertence a elas.

## Cuidados
- Os arquivos em `packages/db/setup/` são cópias de `packages/db/seeds/` (geradas por `scripts/gerar-setup-supabase.sh`).
- O script confere, nos testes automáticos, que cria tudo certo, não duplica, e que a escala passa na validação e publica.
- Se o banco for de produção com clientes reais, a organização demo fica visível só para quem é membro dela, mas apague-a ao terminar.
