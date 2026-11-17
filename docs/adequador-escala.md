# Gerar escala (adequador)

**Escalas › Gerar escala** (`/empresas/[id]/escalas/adequador`; também há o botão na lista de escalas): a gestão informa **turnos, setores, pessoas necessárias, dias de funcionamento, folgas fixas** (e vê as **férias**) e o sistema gera a escala do mês, um rascunho por setor.

## O que você informa
(Ordem na tela: 1 período e funcionamento · 2 jornada de trabalho · 3 turnos · 4 setores e pessoas necessárias · 5 folgas e férias.)

1. **Período e funcionamento:** mês, dias de trabalho por semana (padrão: o que a lei permite; 5 = escala 5x2, 6 = 6x1) e **em quais dias da semana a empresa funciona** (dia fechado = folga de todos, ninguém escalado), com a opção de não funcionar nos feriados.
2. **Turnos:** os turnos (parte dos turnos cadastrados; dá para mudar entrada, saída e intervalo sem alterar o cadastro, ou criar turnos novos, até 6) (até 6), com horas líquidas e semanais mostradas na hora.
3. **Setores e pessoas necessárias:** para cada setor (escolha quais gerar), quantas pessoas cada turno precisa em cada dia da semana; a tela compara com a equipe do setor. "Sugerir" reparte a equipe entre turnos e dias; "Copiar para os outros" replica a cobertura. Quem está sem setor fica de fora (defina em Equipe › Colaboradores › Editar). Sem setores cadastrados, gera para a empresa toda.
4. **Folgas e férias:** **folga fixa** por pessoa (até 3 dias da semana em que ela não trabalha, quando a equipe permite). **Férias e afastamentos** cadastrados aparecem ao lado de cada pessoa e entram sozinhos: a pessoa não é escalada e a equipe cobre sem ela.

## O que o sistema entrega
- **A alocação:** grade pessoa × dia (letra do turno ou folga), gravada num **rascunho** "Adequação AAAA-MM · Setor" (um por setor) que se abre no editor de escalas, se ajusta célula a célula e se publica como qualquer escala. Gerar de novo atualiza o rascunho do mês; nunca mexe em escala publicada.
- **Cobertura atendida** (%) e **onde falta gente** (dia × turno), para decidir entre mudar horários, reduzir a cobertura ou reforçar a equipe.
- **Conferência da lei** pelo motor de regras (o mesmo da escala): folgas semanais, teto semanal, interjornada, intervalo, rodízio de domingo, trabalho em férias/afastamento, cobertura.
- **Funcionamento e férias:** os dias fechados e as férias/afastamentos considerados.
- **Carga de cada pessoa:** dias, horas por semana (média das semanas completas), domingos e feriados trabalhados.

## Como aloca (`packages/servicos/src/adequador.ts`)
Roda no servidor, em milissegundos, sem serviço externo (50 pessoas × 31 dias em ~1 s), de forma **determinística** (mesma entrada, mesma escala).
1. Cada pessoa fica num turno do mês inteiro (quem já tem turno com o mesmo nome fica nele, até o que o turno precisa; o resto é repartido pela necessidade). Turno fixo evita problema de interjornada.
2. Para cada pessoa e semana, a cota de dias de trabalho vem das regras que valem para ela (folgas por semana, teto semanal ÷ horas do turno), limitada pelo que foi pedido. Dia fechado, folga fixa, férias, afastamento, admissão e desligamento tiram dias disponíveis.
3. Parte de blocos de trabalho que avançam um dia por semana (rodízio natural de folgas e domingos) e melhora por trocas dentro da semana: primeiro a **cobertura** (falta pesa muito mais que sobra; a sobra é espalhada pelos dias que mais precisam), depois a **igualdade de domingos** sem piorar a cobertura. Nunca passa do máximo de dias seguidos (6) nem quebra o rodízio de domingo.
4. O resultado é validado pelo motor de regras; o que sobrar de problema aparece na tela.

## Limites
- Um turno fixo por pessoa no mês (não alterna manhã/tarde entre semanas) e escala por dias da semana (não por faixa horária dentro do turno).
- Turnos que se sobrepõem em horário podem mostrar falta de cobertura que a conta por turno não vê; confira no editor.
- Feriados contam como dias normais (com leve preferência por não escalar); ajuste no editor.
- Não substitui o otimizador (Python/OR-Tools) do editor, que considera preferências, custo e estabilidade em relação à escala anterior; o adequador é a forma rápida e sem infraestrutura de chegar a uma boa primeira alocação.


## Jornada de trabalho: aumentar ou reduzir
No passo **Jornada de trabalho** você informa as **horas por semana** (10 a 44; acima de 44h a tela recusa) e os **dias de trabalho**. Cada pessoa passa a trabalhar `dias × horas líquidas por dia` (ex.: 36h em 5 dias = 7h10 líquidas por dia, arredondado a 5 min) e os turnos marcados **"Segue a jornada"** (por padrão, os de 6h líquidas ou mais) têm a **saída ajustada** (entrada e intervalo ficam). Turnos curtos, como meio período, ficam como estão.

A tabela **Impacto da jornada** compara as jornadas mais comuns (44h em 6 ou 5 dias, 42h, 40h, 36h, 30h e a sua, se for outra) para o que você pediu nos setores: **pessoas necessárias** (posições por semana ÷ dias de trabalho, por setor) contra a **equipe** que existe — sobram ou faltam quantas. **Usar** aplica a jornada e os dias com um clique; **Voltar aos turnos como estão** desfaz. A geração mostra "Gerada com jornada de Xh por semana em N dias" e o teto semanal da lei continua valendo (o resultado avisa se um turno limitar os dias).

**Limite importante:** a cobertura é por *turno* (quantas pessoas em cada turno). Ao **reduzir** a jornada, o turno fica mais curto e o fim do período deixa de ser coberto por aquele turno; o sistema não cria sozinho turnos escalonados para cobrir toda a faixa de funcionamento. Para manter o horário de atendimento, use turnos que se complementam (ex.: Manhã 08:00–15:00 e Tarde 12:00–19:00) e peça as pessoas em cada um.

## Fim da escala 6x1 (EC 141/2026)

Na etapa "Jornada de trabalho" há o painel **Adequar ao fim da escala 6x1**:

- As fases (hoje 6x1 com 44h; fase 1 com 5x2 e 42h; fase 2 com 5x2 e 40h) são lidas da tabela `regra_jornada` (`LEGADO_44H`, `EC141_F1`, `EC141_F2`): datas, horas e folgas não estão fixas na tela.
- Mostra quantos colaboradores ainda estão cadastrados em 6x1 (`tipo_escala`) e qual fase vale hoje.
- "Adequar a Nh" preenche jornada e dias; o quadro "Impacto da jornada" mostra quantas pessoas a mais a cobertura exige.
- Se a jornada escolhida passa do teto da fase vigente no mês da escala, aparece um alerta.
- Fase 1: 42h em 5 dias dá mais de 8h por dia; a tela avisa que isso exige acordo coletivo de jornada diária estendida e oferece 40h (8h por dia) como alternativa sem acordo.
- Exceções (terceirizada pública, regime compensatório, alta renda) não são calculadas aqui: confirmar com o jurídico. A data de início da fase 2 segue a confirmar.

## Cobertura por faixa de horário

Na etapa 4 dá para escolher **Por faixa de horário** em vez de "Por turno": em vez de pedir pessoas por turno, a gestão informa quantas pessoas precisam estar presentes em cada faixa do dia (ex.: 08–12, 12–14 no pico do almoço, 14–18), por dia da semana e por setor.

- "Sugerir pelos turnos" cria as faixas a partir das entradas e saídas dos turnos; faixas podem ser adicionadas, editadas e removidas (até 8).
- O motor (`adequarEscala`, parâmetro `faixas`) passa a ignorar o mínimo por turno. A equipe é distribuída entre os turnos pela demanda de cada faixa, e a busca local troca dias de trabalho/folga para fechar a presença de cada faixa. Presença na faixa = o menor número de pessoas de turno em qualquer trecho dela; por isso turnos parciais (manhã + tarde) cobrem juntos uma faixa longa.
- O resultado mostra "onde falta gente" por faixa e dia, e o motor de regras confere a cobertura mínima nas mesmas faixas.
- Limites: o intervalo de refeição não é descontado da presença (todos contam presentes durante o turno, incluindo o intervalo); cada pessoa continua fixa em um único turno no mês. Faixa que nenhum turno cobre inteira gera aviso.
