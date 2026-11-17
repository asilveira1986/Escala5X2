# Importação do ponto (AFD)

Em *Escalas → Ponto (AFD)* o RH envia o arquivo AFD do relógio de ponto; o sistema guarda as marcações e compara com a escala publicada.

## Leiautes aceitos
- **Portaria 1.510/2009** (REPs antigos, ainda em uso): registro tipo 3 com data `ddmmaaaa`, hora `hhmm` e **PIS**.
- **Portaria MTP 671/2021**: registro tipo 3 (REP-C e REP-A) ou 7 (REP-P) com data/hora **ISO 8601 com fuso** e **CPF**.
O leiaute é reconhecido pelo próprio arquivo; um arquivo que mistura os dois é recusado. O CRC-16 não é verificado. Outros registros (empresa, empregado, ajuste de relógio...) são contados e ignorados.

> **Atenção (pendente de validação):** o leitor foi escrito a partir da descrição pública dos leiautes e testado com arquivos sintéticos. Não foi possível conferir o texto oficial da Portaria nem um arquivo real de relógio neste ambiente. **Antes de usar em produção, importe um AFD real do seu relógio** (de preferência um período curto); se o sistema recusar linhas que deveriam valer, mande 5 a 10 linhas do arquivo com CPF/PIS trocados por números fictícios para ajustar o leitor. Por segurança o sistema nunca "adivinha": linha fora do leiaute vira erro com o número da linha (sem CPF/PIS no texto).

## Como a importação funciona
1. O arquivo é lido **no servidor** (até 10 MB; para períodos longos, gere em partes). Precisa começar com o cabeçalho de AFD e, se o cabeçalho trouxer o CNPJ, ele tem que ser o da empresa escolhida.
2. Por padrão, **qualquer linha fora do leiaute recusa o arquivo inteiro** (um AFD com linhas perdidas esconde marcações). Há a opção de importar só o que for válido, listando o restante.
3. Aviso se o arquivo não tem a linha final (trailer) ou se o trailer não bate com a quantidade de marcações (arquivo cortado ou editado).
4. O banco recebe as marcações em lotes; **CPF e PIS não ficam guardados**: vira um código (HMAC com a chave da empresa) e os 4 últimos dígitos. Marcação repetida (mesma pessoa e instante) é ignorada, e o mesmo arquivo não entra duas vezes.
5. Falha no meio desfaz tudo o que entrou.

## Quem é cada identificador
- **CPF** já cadastrado: vincula sozinho.
- **PIS** (ou CPF não cadastrado): aparece em *Identificadores sem colaborador*; o RH escolhe o colaborador **uma vez** e as próximas importações reconhecem.

## Marcações são registro do relógio
Não se editam nem se apagam uma a uma. Importou o arquivo errado? **Desfazer a importação** (com motivo): remove só o que ela trouxe, fica auditado, e o arquivo certo pode ser importado em seguida.

## Escala × ponto (conferência)
Para o mês escolhido, compara a escala publicada com as marcações vinculadas e aponta: **sem marcação** (possível falta), **marcações ímpares**, **atraso**, **saída antecipada**, **tempo além do turno**, **intervalo menor que o previsto**, **marcação em folga** e **durante férias/afastamento**. Tolerância de 5 minutos por marcação (10 no dia, CLT art. 58 §1º). Turno que vira a noite é tratado como um turno só. **A conferência só informa**: não altera escala, banco de horas nem o fechamento da folha (usar as horas apuradas no fechamento é uma etapa futura).

## Ativação
Rodar `packages/db/setup/supabase_atualizar_ponto.sql` (uma vez).

## Segurança
Só quem gere a empresa importa, vincula e desfaz; o colaborador enxerga apenas as próprias marcações; outra organização não vê nada; a importação é auditada (início, conclusão, desfazer, vínculo).

## Folha pelo ponto apurado

No **Fechamento da folha** há o bloco "De onde vêm as horas": **Escala (previstas)** ou **Ponto (apuradas)**. Sem escolha, o sistema usa o ponto quando o mês tem marcações importadas. O que foi escolhido é o que o fechamento guarda (`origem` e `semMarcacao` no retrato) e aparece no Excel (aba Fechamento) e nas duas colunas novas no fim da planilha (*Faltas pelo ponto*, *Dias previstos sem marcação*; as demais colunas não mudam de lugar).

Regras do cálculo pelo ponto (`packages/servicos/src/fechamento.ts`):

- Dia dentro da tolerância da CLT (art. 58 §1º: 5 min por marcação, 10 min por dia): vale o horário da escala.
- Atraso, saída antecipada, tempo além do turno ou intervalo menor: valem as marcações (primeira entrada → última saída, menos as pausas marcadas; com só entrada e saída, vale o intervalo previsto, que é pré-assinalado). Noturno, domingo, feriado e hora extra são recalculados pelo motor com esses horários.
- Dia previsto sem nenhuma marcação: opção **Contar como previsto** (padrão: ponto ainda não tratado) ou **Descontar como falta**. Sempre gera aviso.
- Marcação incompleta (número ímpar): nunca desconta; vale o previsto e vira pendência.
- Marcação em dia de folga: conta como trabalhado, com aviso. Em férias/afastamento: não conta, com aviso.
- Mês sem nenhuma marcação importada: bloqueia o fechamento pelo ponto.

O banco de horas **não** é alimentado pelo ponto nesta etapa: ele segue só pelos lançamentos.
