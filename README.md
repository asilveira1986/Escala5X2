# JornadaCerta

SaaS multiempresa para adequação à escala 5x2 (EC 141/2026). Monorepo pnpm + Turborepo.

```
apps/web            Next.js 15 (login, painéis)
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

### Testes que medem tempo

O runner do CI compartilhado chega a ser **10× mais lento** que uma máquina local, então os testes de desempenho não são benchmarks: o limite fica ao menos 15× acima do tempo local (o tempo local vem no comentário ao lado de cada limite) e serve só para pegar lentidão de ordem de grandeza. Por isso também o tempo máximo de cada teste (`testTimeout`) é de 30 a 60 s nos pacotes e, em `apps/web`, `findBy` e `waitFor` esperam até 5 s (`apps/web/test/setup.ts`). Ao escrever um teste novo desse tipo, siga a mesma folga em vez de apertar o limite.

Ver `docs/fase-0.md` para decisões de arquitetura e pendências de infraestrutura.
