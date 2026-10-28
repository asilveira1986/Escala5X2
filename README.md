# JornadaCerta

SaaS multiempresa para adequação à escala 5x2 (EC 141/2026). Monorepo pnpm + Turborepo.

```
apps/web            Next.js 15 (login, MFA, painéis)
packages/db         migrations SQL (up/down), RLS, auditoria e testes contra Postgres
packages/rules-engine  motor de regras em TS puro (Fase 1)
```

## Desenvolvimento

```bash
pnpm install
scripts/pg-local.sh          # Postgres 16 local descartável (sem Docker)
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm test
```

Os testes de `@jc/db` recriam os schemas `public` e `auth` do banco apontado por
`TEST_DATABASE_URL`: **nunca aponte para um banco com dados**.

Ver `docs/fase-0.md` para decisões de arquitetura e pendências de infraestrutura.
