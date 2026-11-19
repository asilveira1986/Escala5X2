# Identidade visual

Fonte: design system **Jornada** (artefato "Jornada" no claude.ai). Conceito: **tempo é dado, cor é estado, calma na tela.** O símbolo é um **anel de progresso** (a jornada do dia se completando) com um ponto ciano no centro.

| Papel (token do app → token do design system) | Claro | Escuro | Uso |
|---|---|---|---|
| `marca` → brand-500 (Azul Pulso) | `#1F5EFF` | `#5B8BFF` | botões, item ativo, links, anel do logo |
| `marca-escuro` → brand-600 | `#1747CC` | `#8FB0FF` | hover |
| `marca-suave` → brand-soft | `#E8EEFF` | `#16244A` | fundo de selecionado, ícones |
| `destaque` → accent-400 (Ciano Sinal) | `#22D3EE` | `#22D3EE` | ponto do logo, marcadores; só preenchimento, nunca texto em fundo claro |
| `noite` → navy-900 (Azul Noite) | `#0B1530` | `#0B1530` | menu lateral, painel do login, ícone do app |
| `fundo` / `cartao` → surface-50 / surface-0 | `#F4F6FB` / `#FFFFFF` | `#0A1020` / `#111A2E` | páginas / cartões |
| `tinta` / `suave` → ink / ink-muted | `#0B1530` / `#556079` | `#EEF2FA` / `#9AA6BF` | textos |
| `linha` → border | `#DBE1EC` | `#26334F` | bordas e divisores |

**Cor é estado** (nunca decoração): `ok` = em jornada/trabalho (verde `#0B7A3B` sobre `#E3F6EA`), `atencao` = intervalo/perto do limite (âmbar `#94520A` sobre `#FDF1DC`), `violeta` = hora extra/banco positivo (`#5A2FD6` sobre `#EFE9FF`), `risco` = atraso/falta/inconsistência (`#B4233A` sobre `#FDE8EB`), `neutro` = folga/férias. Estado nunca depende só da cor: sempre há rótulo ou seta.

- Tudo é token em `apps/web/app/globals.css`; trocar a marca é editar esse arquivo (mais `lib/pwa/icone.tsx` e `app/manifest.ts` para o ícone do app, e `MarcaLogo` em `components/icones.tsx`).
- **Logotipo:** `MarcaLogo` (anel + ponto ciano, cores fixas do logotipo; `negativo` para fundo Azul Noite). O nome do produto segue **JornadaCerta** (o design system chama a marca de trabalho de "Jornada"; o wordmark é só texto em Plus Jakarta Sans 800, fácil de trocar).
- **Tema escuro:** `marca` vira `#5B8BFF` com texto escuro (`sobre-marca` `#0A1020`), porque o mesmo token serve de fundo de botão e de cor de texto/link; assim todos os pares passam em contraste AA. Menu e painel do login continuam em Azul Noite nos dois temas.
- **Foco de teclado:** contorno de 3 px na cor da marca (no menu escuro, o mesmo token fica branco). O ciano do design system não passa 3:1 sobre fundo claro, por isso não é usado como anel de foco no conteúdo.

## Fonte

**Plus Jakarta Sans** (400–800) para interface e títulos e **JetBrains Mono** (400/500/700) para **todo horário, saldo e número de indicador**, com dígitos tabulares (classe `horario` ou `font-mono`; `Metrica` já usa). Vêm do Google Fonts (`app/layout.tsx`) e são definidas pelos tokens `--font-titulo`, `--font-texto` e `--font-horario`. Rótulos de coluna e de indicador usam a classe `rotulo-col` (11 px, negrito, caixa alta, espaçamento 0,08 em).

## Forma

Cartões e painéis: raio 16 px (`rounded-2xl`), borda `linha`, sombra `shadow-card` (token `--sombra-card`). Botões e campos: raio 10 px. Selos e avatares: pílula. Menus flutuantes e popovers: `shadow-pop`.

## Menu lateral

O menu usa o **Azul Noite** (`#0B1530`) nos dois temas. Item ativo = Azul Pulso com texto branco; hover = branco a 7 %; ícones de traço herdam a cor do texto. Está na classe `.tema-menu` (`globals.css`), que só redefine os tokens dentro do menu.

## Telas

- **Cabeçalho de página:** toda tela do menu abre com ícone, título e uma frase de apoio (`CabecalhoPagina`), vindos do próprio menu (`lib/menu.ts`: `descricao`). Telas com título próprio (Visão geral, Carteira, cadastros) ficam marcadas com `proprioTitulo`.
- **Cartões:** `Cartao` aceita `icone` e `acoes` (botões no canto). `Metrica` mostra número + ícone. `IconeCaixa` é o quadradinho colorido do ícone.
- **Visão geral da empresa:** identificação, quatro números e "Primeiros passos" com barra de progresso. Não repete atalhos para as áreas: a navegação mora só no menu.

## Cor nos ícones e indicadores

Seguindo "cor é estado", os ícones (menu, cabeçalhos, cartões, números) usam a cor da marca por padrão; só viram verde, âmbar, violeta ou vermelho quando a tela passa um tom de estado (`tom` em `Metrica`/`IconeCaixa`). O mapa antigo por área (`tomDoIcone` em `lib/menu.ts`) continua disponível, mas não é mais aplicado automaticamente. Os números têm uma faixa colorida no topo; a Visão geral é um cartão limpo, sem degradê; a área de conteúdo tem um degradê azul muito leve (5 %) no topo.

## Layout compacto e menu (regras para não duplicar informação)

- **Densidade:** raiz de 15 px, conteúdo em `max-w-5xl`, cartões `p-3.5/4`, números `text-xl`, botões e campos de 32 px no desktop (44 px no celular, por toque), itens do menu de 36/32 px e menu lateral de 15 rem (4 rem recolhido).
- **Menu em grupos:** Visão geral · Adequação EC 141 (Prontidão, Diagnóstico) · Colaboradores · Escalas (Escalas do mês, Gerar escala, Férias e afastamentos) · Pedidos · Ponto e folha · e, no fim, **Configurações** num só submenu, em dois blocos: *Desta empresa* (Turnos, Cobertura mínima, Importar planilha) e *Do sistema* (Empresas, Plano e cobrança).
- **Submenu dinâmico:** abre sozinho o grupo da página atual, só um grupo fica aberto (abrir outro fecha o anterior; clicar no aberto fecha) e volta ao da página ao navegar. O cookie guarda só se o menu está recolhido.
- **Uma informação, um lugar:** ações que têm botão na própria tela ("Nova empresa", "Novo colaborador") não são itens do menu; a empresa aparece no seletor do menu (e, no celular, no caminho); o título da página aparece só no cabeçalho dela, então a barra de cima mostra apenas o caminho até ali (sem repetir a página); a Visão geral não duplica os atalhos do menu; o título de seção "Empresa" não repete o seletor.
- **Telas de dentro:** o cartão principal não repete o título da página (que já vem do menu): Cobertura, Férias e afastamentos, Banco de horas, Banco pelo ponto, Pedidos, Turnos, Escalas e Colaboradores ficaram sem o título repetido (só com a explicação de como funciona, quando ela acrescenta algo). Os links "← Escalas" e "← Banco de horas" saíram: o menu já leva a esses lugares. O cartão "Gerar escala automaticamente" da lista de escalas saiu, porque "Gerar escala" já é item do menu.

## Telas em abas

Telas com muito conteúdo foram divididas em **abas por endereço** (`?aba=`, componente `Abas`, helper `lerAba`): cada aba é uma página leve, funciona sem JavaScript, mantém o mês e outros filtros e dá para compartilhar o link. A primeira aba é o endereço limpo; só a aba pedida é calculada (a conferência do ponto, por exemplo, só carrega as marcações na aba "Escala × ponto").

- **Prontidão EC 141:** Resumo e setores · Custo · Comunicados (com o número de ciências pendentes).
- **Diagnóstico (detalhe):** Resumo · Cenários de custo (com a contagem de cenários) · Pessoas.
- **Ponto:** Escala × ponto · Importar e arquivos (com a contagem de identificadores sem colaborador).
- **Folha:** Prévia do mês · Fechamento e versões.
- **Plano e cobrança:** Assinatura e planos · Faturas (com as pendentes/vencidas).

## Colaboradores: lista enxuta e tela própria

A lista mostra só **Nome, Setor e Status** (situação do acesso ao app). Clicar na linha (ou no nome, que é um link) abre a **tela do colaborador**, a mesma de edição, organizada assim:

- **Cabeçalho:** iniciais, nome, cargo · setor · data de admissão e a situação (Ativo/Desligado).
- **Resumo do contrato atual**, sempre à vista: escala, jornada, salário e valor/hora (em fonte mono).
- **Abas por endereço** (`?aba=`, como nas outras telas): *Dados pessoais* (Identificação e Trabalho), *Contrato e escala* (mudança de contrato e histórico), *Acesso ao app* (convidar, reenviar, remover) e *Desligamento*. Cada aba mostra só o seu assunto.

A busca da lista continua achando por cargo, escala e matrícula, mesmo ocultos (`colunasOcultas` e `aoClicarLinha` em `TabelaDados`). Quem não gere a empresa vê a lista sem links.

## Padrão: lista enxuta, tela do item

Além de Colaboradores, o mesmo formato vale para **Escalas do mês, Turnos, Cobertura mínima, Férias e afastamentos, Pedidos, Banco de horas, Empresas e Diagnósticos**:

- **Lista:** um cartão com a contagem no título, o botão de criar no canto ("Nova escala", "Novo turno", "Nova faixa", "Lançar ausência") e uma tabela só com o essencial (`TabelaLista`: a linha toda é clicável e o primeiro campo é um link de verdade). A busca fica no topo.
- **Criar:** o botão abre uma tela própria (`/nova`, `/novo`), com o formulário num cartão. Ao salvar, volta para a lista.
- **Tela do item** (`CabecalhoItem` + `ResumoItem`): cabeçalho com ícone ou iniciais, título, uma linha de apoio e a situação; faixa de resumo com os números principais em fonte mono; depois os cartões do assunto (editar, observação) e, no fim, **Remover** em dois passos (`RemoverItem`), que volta para a lista.
- Quem não gere a empresa vê as listas sem links, sem botão de criar e sem remoção.
- Férias e afastamentos ganharam a coluna **Situação** (Agendada, Em andamento, Encerrada), calculada pelas datas (`lib/ausencias.ts`).
- O editor de uma escala (`/escalas/[escalaId]`) continua sendo a tela do item de Escalas do mês.
- **Edição:** a tela da **faixa de cobertura** edita dia, horário, mínimo, ideal e setor (`editarDemanda`, com as mesmas regras de quando se cria); a tela da **ausência** edita tipo, período e observação (`editarAusencia`; a sobreposição de períodos da mesma pessoa continua barrada pelo banco). Quem é a pessoa não muda: para outra pessoa, remova e lance de novo. Só a gestão vê os formulários.
- **Pedidos:** as abas (Para decidir, Aguardando o colega, Encerradas) ficam no topo e a lista mostra Pessoa, Pedido, Pedido em e Situação, sem calcular nada pesado. A **conferência das regras da escala** só roda ao abrir o pedido, na tela dele: cabeçalho, resumo, "O pedido" (descrição, motivo e resposta) e "Decisão" (aprovar, ou recusar com motivo). A busca acha pelas datas e pelo colega, mesmo ocultos.
- **Banco de horas:** a lista mostra Pessoa, Saldo e Situação (Vencido a pagar, Saldo negativo, Vence em breve, Em dia, Sem lançamentos; `situacaoBanco` em `lib/banco-horas-ui.ts`), com a estimativa a pagar ao lado quando há horas vencidas e o total da empresa no aviso do topo. A gestão vê também quem ainda não tem lançamentos (some o cartão "Outros colaboradores"). A tela da pessoa tem o saldo no resumo e abas: *Extrato* (com estorno), *Vencimentos* (lotes por data, com a contagem) e *Novo lançamento* (só gestão). A tela do colaborador no app (`/minha-escala/banco-horas`) não mudou.
- **Empresas:** a lista mostra Empresa, CNPJ e Situação da adequação (porte e UF ficam só na busca); clicar abre a **Visão geral** da empresa, cujo cabeçalho agora segue o formato dos itens (nome, CNPJ · porte · UF e a situação), com as quatro métricas e os "Primeiros passos" abaixo. O cartão em grade (`CartaoEmpresa`) saiu.
- **Diagnósticos:** a lista mostra Referência, Pessoas e Situação (`situacaoDiagnostico`: "N a adequar", "Tudo adequado" ou "Sem resumo"; a data de geração fica na busca). "Novo diagnóstico" abre tela própria (`/diagnostico/novo`) e, ao rodar, vai direto para o resultado. O passo a passo no topo só aparece enquanto a jornada não está completa. No diagnóstico, o cabeçalho traz a referência, a geração, a situação e os downloads (PDF e planilha), e o resumo mostra Pessoas, A adequar, Horas a cobrir (fase 2) e Folha mensal; as abas Resumo, Cenários e Pessoas continuam.
- Regra de código: funções usadas por componentes de servidor e de cliente (como as situações) ficam em `lib/`, nunca dentro de arquivos `'use client'`.

## Importar planilha e Plano e cobrança

- **Importar planilha:** duas abas por endereço, *Nova importação* (o assistente em etapas, como antes) e *Importações* (com a contagem), que usa a lista no formato padrão: Enviada em, Resultado ("12 criados · 3 atualizados · 2 com erro") e Situação. Clicar abre a **tela da importação**: cabeçalho com a data e a situação, resumo (Criados, Atualizados, Sem alteração, Com erro), cartão com os erros por linha e o download em CSV, e os atalhos "Ver colaboradores" e "Rodar diagnóstico". Enquanto processa, a tela se atualiza sozinha. Os textos e tons da situação ficam em `lib/importacao-ui.ts`.
- **Plano e cobrança:** o cabeçalho traz a situação da assinatura (Ativa, Em teste, Fatura vencida…) e o resumo fica sempre à vista (Plano, Próximo vencimento ou Teste até, Forma de pagamento, Colaboradores ativos, que ganha destaque ao passar do limite do plano). Abas *Planos* (cartões dos planos com os preços em fonte mono e, para quem tem assinatura em andamento, o cartão "Encerrar a assinatura") e *Faturas* (com a contagem das abertas; tabela com busca, "Pagar" nas abertas e "Ver" nas pagas). Quem não é administrador continua vendo só o aviso de acesso.
