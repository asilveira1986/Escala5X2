# Prontidão para a EC 141

Página **Empresa › Prontidão EC 141** (`/empresas/[id]/prontidao`). Calcula na hora, com os contratos vigentes e as regras cadastradas (`diagnostico_entrada` + `diagnosticar`), sem gravar nada:

- **Medidor por fase**: % de pessoas que já atendem jornada e folgas da fase 1 (42h) e da fase 2 (40h), com a data e os dias que faltam. Fica vermelho quando restam 45 dias ou menos e ainda há gente a adequar.
- **Por setor**: pessoas, quantas precisam mudar em cada fase, horas semanais a cobrir e pessoas a mais (equivalente em tempo integral). Situação: Pronto, Pronto na fase 1 ou Adequar já.
- **Custo para cobrir as horas**: horas extras × contratação, nas duas fases, recalculado ao editar encargos, adicional de hora extra e custo por contratação. Usa o simulador do motor (`simular`), inclui o efeito do divisor menor nas horas extras já praticadas e nunca reduz salário. O de menor custo anual é marcado.

Complementa o **Diagnóstico** (que grava o resultado, simula mais cenários e gera PDF/planilha): a Prontidão é o retrato de hoje, sempre atual.

Limites: estimativa de planejamento; os encargos são informados pelo usuário (sem padrão legal) e não inclui rescisão, férias e 13º além deles. Os dados vêm do cadastro de contratos: contrato desatualizado, prontidão desatualizada.
