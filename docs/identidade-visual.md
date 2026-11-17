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
- **Visão geral da empresa:** identificação, quatro números, "Primeiros passos" com barra de progresso e as áreas do sistema (montadas a partir do menu, então novas telas aparecem lá sozinhas).

## Cores por área

Cada área do sistema tem uma cor de apoio, aplicada ao ícone (menu, cabeçalhos, cartões, números): **Equipe e Carteira = azul**, **Escalas = violeta**, **Pedidos = âmbar**, **Ponto e folha = verde**, **Diagnóstico = rosa**, empresa/início = índigo da marca. O mapa está em `tomDoIcone` (`lib/menu.ts`); os tons são tokens em `globals.css` (`--c-azul-*`, `--c-violeta-*`, `--c-verde-*`, `--c-ambar-*`, `--c-rosa-*`), com versões para o tema escuro e para o menu lateral. Os números têm uma faixa colorida no topo; a Visão geral tem degradê índigo→violeta; a área de conteúdo tem um leve degradê no topo.
