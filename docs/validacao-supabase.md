# Validação no Supabase real (próxima sessão)

Estado: as Fases 0 e 1 estão na `main`, testadas em Postgres local. **Nada foi exercitado contra um Supabase real.**
Este roteiro é o que a próxima sessão deve executar, nesta ordem, parando no primeiro erro e relatando a mensagem completa.

## 0. Pré-condições (conferir antes de qualquer coisa)
- Variáveis presentes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Session pooler, porta 5432).
- Rede libera `*.supabase.co` e `*.pooler.supabase.com`. Teste: `curl -s -o /dev/null -w '%{http_code}' $SUPABASE_URL/auth/v1/health -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"` deve dar 200.
- Se algo faltar, **parar e pedir ao usuário**: não simular resultados e **nunca pedir chaves no chat**.
- Segredo `chave_dados` no Vault (o usuário cria no painel; sem ele a importação falha).

## 1. Banco
1. Aplicar, em ordem, `packages/db/migrations/0001` a `0004` (`*.up.sql`) e as seeds `packages/db/seeds/regras.sql` e `feriados.sql`, via `psql "$DATABASE_URL"` (uma transação por arquivo).
2. Conferir: 8 linhas em `regra_jornada`, 30 feriados, RLS ativo em todas as tabelas de `public`, buckets `importacoes` e `marca` privados, Security Advisor sem avisos críticos.
3. Pontos de atenção específicos do Supabase (nunca testados lá): `pgcrypto` fica no schema `extensions` (as funções já usam `search_path` com ele); `segredo()` lê `vault.decrypted_secrets`; gatilho em `auth.users`; políticas em `storage.objects`.
4. O passo de CI espera `supabase/migrations/<timestamp>_nome.sql`; hoje as migrations estão em `packages/db/migrations`. Decidir: mover/duplicar para o padrão da CLI.

## 2. Primeiro usuário
- Criar o usuário pelo painel (Authentication → Users, Auto Confirm) ou pela API Admin. O gatilho 0004 cria `public.usuario`.
- No app: entrar → tela "Crie a sua organização" → cadastro do autenticador (TOTP) → ver a organização.
- Superadmin da plataforma (só por SQL): `insert into membro values ('00000000-0000-0000-0000-000000000001', '<uid>', 'superadmin');`

## 3. Fluxo ponta a ponta (app local `pnpm --filter @jc/web dev` ou deploy de preview)
1. Login por senha; link mágico; MFA obrigatório para admin.
2. Criar empresa (CNPJ válido). Upload de planilha (URL assinada ao Storage), mapeamento, validação, confirmação.
3. Worker: `pnpm --filter @jc/jobs start` com `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Conferir que a importação passa de "processando" a "concluída".
4. Diagnóstico, simulador (incluindo cenário bloqueado por redução salarial), exportação PDF e XLSX (conferir o registro em `auditoria`).
5. Isolamento: segundo usuário em outra organização não vê nada da primeira.

## 4. Registrar
Atualizar `docs/fase-1.md` (pendências) com o que passou, o que falhou e o que foi corrigido.
