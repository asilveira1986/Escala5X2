# Histórico e versões das escalas

Cada publicação cria uma **nova versão** e a anterior fica guardada como *substituída*, com as alocações e o código de integridade (hash) da época. Nada é apagado nem editado depois de publicado.

## Tela de histórico
Em qualquer escala, o botão **Histórico** abre `/empresas/[id]/escalas/[escalaId]/historico` com:

- **Versões** da mesma escala (mesma empresa, setor e período): situação, quando e por quem foi publicada, e os 12 primeiros caracteres do hash.
- **O que mudou**: compara a escala aberta com a versão publicada anterior (ou com a que você escolher em "Comparar com esta"). Mostra pessoas afetadas, dias alterados, quem passou a trabalhar, quem passou a folgar e a lista dia a dia, "antes → depois" (horário com intervalo, folga, férias etc.). Até 150 linhas.

## Restaurar uma versão
Numa versão substituída, **Restaurar esta versão** cria um **novo rascunho** com as alocações dela (a mesma ação de "Criar nova versão" de uma publicada). A versão restaurada passa pelo motor de regras e pela publicação como qualquer rascunho; nada muda na escala vigente até você publicar. A restauração copia as alocações como estavam: se houver férias, contratos ou regras novos desde então, o motor mostrará as violações ao validar.

## Limites
- A comparação é por dia e por pessoa; não compara cobertura nem custo.
- Quem foi escalado só aparece com o nome se tiver contrato vigente na escala aberta; senão aparece como "Colaborador".
- Não há instalador SQL: usa as tabelas existentes.
