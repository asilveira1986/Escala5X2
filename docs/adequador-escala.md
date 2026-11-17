# Gerar escala (adequador)

**Escalas › Gerar escala** (`/empresas/[id]/escalas/adequador`; também há o botão na lista de escalas): a gestão informa **turnos, setores, pessoas necessárias, dias de funcionamento, folgas fixas** (e vê as **férias**) e o sistema gera a escala do mês, um rascunho por setor.

## O que você informa
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
