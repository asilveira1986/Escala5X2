# Identidade visual

Conceito: **tecnologia de gestão de pessoas** — limpa, confiável e leve de usar. Índigo é a família de cor mais associada a software de RH/SaaS; a menta marca os "dias de folga" do logotipo.

| Papel | Claro | Escuro | Uso |
|---|---|---|---|
| Marca (índigo) | `#4F46E5` | `#A5B4FC` | botões, item ativo, links |
| Marca escura | `#3730A3` | `#C7D2FE` | hover, degradê do login |
| Marca suave | `#EEF0FF` | `#1C2347` | fundo do item ativo, ícones |
| Destaque (menta) | `#5EEAD4` | `#5EEAD4` | dias de folga no logo, marcadores |
| Fundo / cartão | `#F6F7FB` / `#FFFFFF` | `#0B1020` / `#131A2E` | páginas / cartões |
| Texto / texto suave | `#0F172A` / `#5B6478` | `#E8ECF8` / `#9AA5C0` | |
| OK / Atenção / Risco | verde `#0B5A3A`, âmbar `#7A4B00`, rosa `#9F1239` sobre tons claros | versões claras sobre tons escuros | status |

- Todos os pares de texto passam em contraste AA (mínimo 5,5:1 medido).
- Tudo é token em `apps/web/app/globals.css`; trocar a marca é editar esse arquivo (mais `lib/pwa/icone.tsx` e `app/manifest.ts` para o ícone do app).
- Logotipo: cinco barras (dias úteis) + uma menta (folga), em `MarcaLogo` e nos ícones do PWA.

## Menu lateral

O menu usa um **índigo profundo** (`#1E1B4B`) nos dois temas para se separar do conteúdo claro. Está na classe `.tema-menu` (`globals.css`), que só redefine os tokens dentro do menu; texto 13:1, texto suave 8:1 e item ativo 9:1 de contraste.

## Telas

- **Cabeçalho de página:** toda tela do menu abre com ícone, título e uma frase de apoio (`CabecalhoPagina`), vindos do próprio menu (`lib/menu.ts`: `descricao`). Telas com título próprio (Visão geral, Carteira, cadastros) ficam marcadas com `proprioTitulo`.
- **Cartões:** `Cartao` aceita `icone` e `acoes` (botões no canto). `Metrica` mostra número + ícone. `IconeCaixa` é o quadradinho colorido do ícone.
- **Visão geral da empresa:** identificação, quatro números e "Primeiros passos" com barra de progresso. Não repete atalhos para as áreas: a navegação mora só no menu.

## Cores por área

Cada área do sistema tem uma cor de apoio, aplicada ao ícone (menu, cabeçalhos, cartões, números): **Equipe e Carteira = azul**, **Escalas = violeta**, **Pedidos = âmbar**, **Ponto e folha = verde**, **Diagnóstico = rosa**, empresa/início = índigo da marca. O mapa está em `tomDoIcone` (`lib/menu.ts`); os tons são tokens em `globals.css` (`--c-azul-*`, `--c-violeta-*`, `--c-verde-*`, `--c-ambar-*`, `--c-rosa-*`), com versões para o tema escuro e para o menu lateral. Os números têm uma faixa colorida no topo; a Visão geral tem degradê índigo→violeta; a área de conteúdo tem um leve degradê no topo.

## Fonte

Toda a interface usa **Inter** (400–700), em títulos e texto, com espaçamento levemente fechado nos títulos. A fonte vem do Google Fonts (`app/layout.tsx`) e é definida pelos tokens `--font-titulo` e `--font-texto` em `globals.css`; sem a fonte, cai para Segoe UI/sistema.

## Layout compacto e menu (regras para não duplicar informação)

- **Densidade:** raiz de 15 px, conteúdo em `max-w-5xl`, cartões `p-3.5/4`, números `text-xl`, botões e campos de 32 px no desktop (44 px no celular, por toque), itens do menu de 36/32 px e menu lateral de 15 rem (4 rem recolhido).
- **Menu em grupos:** Visão geral · Adequação EC 141 (Prontidão, Diagnóstico) · Colaboradores · Escalas (Escalas do mês, Gerar escala, Férias e afastamentos) · Pedidos · Ponto e folha · e, no fim, **Configurações** num só submenu, em dois blocos: *Desta empresa* (Turnos, Cobertura mínima, Importar planilha) e *Do sistema* (Empresas, Plano e cobrança).
- **Submenu dinâmico:** abre sozinho o grupo da página atual, só um grupo fica aberto (abrir outro fecha o anterior; clicar no aberto fecha) e volta ao da página ao navegar. O cookie guarda só se o menu está recolhido.
- **Uma informação, um lugar:** ações que têm botão na própria tela ("Nova empresa", "Novo colaborador") não são itens do menu; a empresa aparece no seletor do menu (e, no celular, no caminho); o título da página aparece só no cabeçalho dela, então a barra de cima mostra apenas o caminho até ali (sem repetir a página); a Visão geral não duplica os atalhos do menu; o título de seção "Empresa" não repete o seletor.
