# Fase 0 — Fundação

## Entregue
- Monorepo (pnpm + Turborepo, TS strict), CI (lint, typecheck, testes com Postgres 16; migrations em homologação a cada merge e em produção com aprovação manual via *environment* `producao`).
- Migration `0001_fundacao` (up/down): `organizacao`, `usuario`, `membro`, `empresa`, `vinculo_empresa`, `acesso_suporte`, `auditoria`.
- RLS em todas as tabelas; funções `minhas_organizacoes`, `tenho_papel`, `pode_acessar_empresa`, `pode_gerir_empresa`.
- MFA (aal2) exigido para superadmin, admin, contador e advogado **no banco** (RLS) e no middleware.
- Auditoria append-only (triggers bloqueiam update/delete/truncate), com cadeia de hash SHA-256 por organização. Toda tabela nova deve chamar `auditar_tabela('tabela')`.
- Suporte do superadmin só com motivo (≥10 caracteres) e prazo (≤7 dias), auditado.
- App web: login (senha, link mágico, Google), cadastro/verificação TOTP, redirecionamento por papel/MFA.

## Decisões
- `empresa` usa política de SELECT inline: `pode_acessar_empresa` não enxerga a linha criada no mesmo comando (`INSERT ... RETURNING`). Tabelas filhas devem usar a função.
- Sem `FORCE ROW LEVEL SECURITY`: as funções `security definer` dependem de o dono ignorar o RLS (como o `postgres` do Supabase).
- Testes rodam em Postgres puro com um shim de `auth` (`packages/db/test/supabase-shim.sql`), não no Supabase real.
- Criação de organização só via `criar_organizacao()`; o tipo `plataforma` e o papel `superadmin` só por service role.

## Pendências que dependem de você (não foi possível fazer daqui)
1. Criar três projetos Supabase (dev, homolog, prod) em `sa-east-1`; habilitar MFA TOTP, provedor Google e link mágico; configurar URLs de redirect.
2. Secrets no GitHub: `HOMOLOG_DATABASE_URL`, `PROD_DATABASE_URL`; criar environments `homologacao` e `producao` (revisores obrigatórios).
3. Variáveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` na Vercel.
4. O CI usa `supabase db push`, que espera o layout `supabase/migrations` com nomes timestampados; hoje as migrations estão em `packages/db/migrations`. Ajustar no passo de deploy (ou adotar a CLI como runner) antes do primeiro merge.
5. Não testado: fluxo real de login/MFA contra o Supabase (só o build, tipos e a lógica de redirecionamento).
6. `middleware.ts` consulta `membro` a cada requisição; avaliar cache/claim no JWT se pesar.
