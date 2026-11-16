# Interruptor da verificação em duas etapas (MFA)

Por regra, `admin`, `contador`, `advogado` e `superadmin` só enxergam dados depois de verificar o código do autenticador. Este interruptor dispensa a verificação para **todos os papéis**, e existe **somente para ambientes de teste, sem dados reais**.

## Como funciona
- **Fonte única da verdade:** a tabela `configuracao_sistema` (chave `mfa_obrigatorio`). O RLS do banco e o middleware do app leem dela. Por isso não há como desligar só um dos lados.
- **Padrão seguro:** ligado. Linha ausente, valor inválido ou qualquer coisa diferente de `false` exato conta como ligado. Se o app não conseguir consultar o estado, também exige.
- **Quem muda:** só quem tem acesso direto ao banco (SQL Editor do Supabase ou `service_role`). Usuários do app não leem nem escrevem a tabela.
- **Auditoria:** toda mudança é gravada na auditoria, com o motivo (obrigatório, mínimo 5 caracteres).
- **Aviso na tela:** enquanto estiver desligado, uma faixa amarela aparece no topo do app: "Modo de teste: a verificação em duas etapas está desativada neste ambiente".

## Instalar (banco já instalado com as migrations 0001 a 0004)
SQL Editor → **New query** → cole `packages/db/setup/supabase_atualizar_interruptor_mfa.sql` → **Run**. O resultado deve mostrar `mfa_obrigatorio | true | padrão seguro`.
Instalação nova: o `supabase_instalar_tudo.sql` já inclui (agora são 22 tabelas com RLS).

## Desligar (teste)
```sql
select definir_mfa_obrigatorio(false, 'Testes iniciais sem dados reais');
```
## Ligar de novo
```sql
select definir_mfa_obrigatorio(true, 'Fim dos testes');
```
## Ver o estado
```sql
select chave, valor, motivo, atualizado_em from public.configuracao_sistema;
```

## Cuidados
- Desligado, `superadmin` também entra sem MFA, inclusive o acesso de suporte a dados de clientes. Não use com dados reais.
- **Antes de usar com clientes, ligue de novo** e confira a faixa amarela sumir.
- Quem já tinha um autenticador cadastrado continua com ele; ao religar, volta a ser pedido.
