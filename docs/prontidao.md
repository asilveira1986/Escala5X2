# Prontidão para a EC 141

Página **Empresa › Prontidão EC 141** (`/empresas/[id]/prontidao`). Calcula na hora, com os contratos vigentes e as regras cadastradas (`diagnostico_entrada` + `diagnosticar`), sem gravar nada:

- **Medidor por fase**: % de pessoas que já atendem jornada e folgas da fase 1 (42h) e da fase 2 (40h), com a data e os dias que faltam. Fica vermelho quando restam 45 dias ou menos e ainda há gente a adequar.
- **Por setor**: pessoas, quantas precisam mudar em cada fase, horas semanais a cobrir e pessoas a mais (equivalente em tempo integral). Situação: Pronto, Pronto na fase 1 ou Adequar já.
- **Custo para cobrir as horas**: horas extras × contratação, nas duas fases, recalculado ao editar encargos, adicional de hora extra e custo por contratação. Usa o simulador do motor (`simular`), inclui o efeito do divisor menor nas horas extras já praticadas e nunca reduz salário. O de menor custo anual é marcado.

Complementa o **Diagnóstico** (que grava o resultado, simula mais cenários e gera PDF/planilha): a Prontidão é o retrato de hoje, sempre atual.

Limites: estimativa de planejamento; os encargos são informados pelo usuário (sem padrão legal) e não inclui rescisão, férias e 13º além deles. Os dados vêm do cadastro de contratos: contrato desatualizado, prontidão desatualizada.

## Comunicados de adequação de jornada (PDF)

Na Prontidão, o cartão **Comunicados de adequação** baixa um PDF por fase (`GET /api/v1/empresas/[id]/comunicados?fase=F1|F2[&setor=Nome]`), com **uma página por colaborador** que perde horas na fase: jornada atual → nova jornada, dias de trabalho e de repouso, garantia de salário e campo de ciência. A tabela por setor também tem links por setor.

- Só quem gere a empresa baixa (`pode_gerir_empresa`); os dados vêm do mesmo cálculo da Prontidão. Quem está em exceção (alta renda, acordo) fica de fora.
- Até 500 colaboradores por PDF; acima disso, filtre por setor.
- É uma **minuta**: o texto é padrão e deve ser revisado pelo jurídico antes de usar. O PDF traz esse aviso no rodapé.
- O download do PDF é registrado na trilha de auditoria (`baixar_pdf_f1`/`f2`), se o SQL de comunicados estiver aplicado.

## Emissão e ciência dentro do sistema (migration 0024)

Além do PDF, a gestão pode **Emitir fase 1/2** na própria Prontidão:

- Grava um comunicado por colaborador em `comunicado_jornada` (jornada atual, nova jornada, dias de trabalho e repouso, quem emitiu e quando). A tabela só muda pelas funções `emitir_comunicados`, `registrar_ciencia_comunicado` e `registrar_download_comunicados` (sem escrita direta); a emissão e a ciência entram na trilha de auditoria encadeada.
- Quem tem acesso ao sistema recebe um aviso no sino e vê o texto em **Minha escala › Comunicados**, onde confirma "Li e estou ciente" (só o próprio colaborador, uma vez; guarda data e usuário).
- Reemitir com os mesmos valores não repete aviso nem apaga ciência. Se algum valor mudar (outra fase, nova jornada), o comunicado é atualizado e a ciência volta a ser exigida.
- A Prontidão mostra, por fase, quantos foram emitidos, quantos deram ciência e os nomes dos pendentes. Quem não tem acesso ao sistema assina o PDF impresso.
- Sem o SQL aplicado, a seção de emissão some e o PDF continua funcionando.

Instalador incremental: `packages/db/setup/supabase_atualizar_comunicados.sql` (exige o das notificações e o do aviso do banco antes).
