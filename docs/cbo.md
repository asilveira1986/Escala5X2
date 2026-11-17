# CBO (Classificação Brasileira de Ocupações)

O campo **Ocupação (CBO)** do cadastro de colaborador é um seletor: digite o código ou parte do nome e escolha na lista. Ao escolher, o cargo é preenchido se estiver vazio.

- **Dados:** `apps/web/lib/cbo-dados.json` — 2.445 ocupações da CBO 2002 (`["2521-05","Administrador"]`), a lista de ocupações canônicas (sem sinônimos) do projeto de dados abertos `okfn-brasil/datasets-br-cbo`, que transcreve a tabela oficial do Ministério do Trabalho. O site oficial (mtecbo.gov.br) não estava acessível daqui; **ocupações criadas depois dessa tabela podem faltar**. Para atualizar, substitua o JSON mantendo o formato (código `0000-00`, nome, ordenado por código).
- **Busca:** `apps/web/lib/cbo.ts` (código com ou sem hífen; nome sem diferenciar acento/maiúscula; quem começa com o texto vem primeiro).
- **Carregamento:** a lista (~110 KB) só é baixada na tela de cadastro, não no resto do sistema.
- **Servidor:** o código escolhido é conferido contra a lista antes de gravar; o CBO é gravado só com dígitos (`411010`), como na importação por planilha.
