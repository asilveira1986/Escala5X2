# App web (Next.js). Contexto de build = raiz do repositório (precisa dos pacotes @jc/*).
# Railway: variável RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/connectors/package.json packages/connectors/
COPY packages/documents/package.json packages/documents/
COPY packages/rules-engine/package.json packages/rules-engine/
COPY packages/servicos/package.json packages/servicos/
COPY packages/db/package.json packages/db/
COPY jobs/package.json jobs/
RUN pnpm install --frozen-lockfile --filter @jc/web...

FROM deps AS build
# Variáveis NEXT_PUBLIC_* entram no código na hora do build: o Railway as repassa como ARG.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# Falha cedo e com mensagem clara se faltar variável (senão o app sobe e dá "Internal Server Error").
RUN for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY; do \
      eval "val=\$$v"; [ -n "$val" ] || { echo "ERRO: a variável $v está vazia no build. Defina-a no serviço (aba Variables) e refaça o deploy."; exit 1; }; \
    done
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
COPY jobs jobs
RUN pnpm --filter @jc/web build

FROM node:22-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /repo
RUN useradd --system --uid 1001 app
COPY --from=build --chown=app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app /repo/apps/web/.next/static ./apps/web/.next/static
# Arquivos públicos (service worker): o modo standalone do Next não os inclui sozinho.
COPY --from=build --chown=app /repo/apps/web/public ./apps/web/public
USER app
# O Railway define PORT; o servidor do Next lê PORT.
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
