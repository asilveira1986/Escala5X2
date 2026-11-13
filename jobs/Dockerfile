# Worker de importação (pg-boss). Contexto de build = raiz do repositório.
# Railway: variável RAILWAY_DOCKERFILE_PATH=jobs/Dockerfile
FROM node:22-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
# O lockfile cobre todo o monorepo: os manifestos de todos os pacotes precisam estar presentes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/connectors/package.json packages/connectors/
COPY packages/documents/package.json packages/documents/
COPY packages/rules-engine/package.json packages/rules-engine/
COPY packages/servicos/package.json packages/servicos/
COPY packages/db/package.json packages/db/
COPY jobs/package.json jobs/
# tsx (devDependency) executa o TypeScript; por isso a instalação inclui as dependências de desenvolvimento.
RUN pnpm install --frozen-lockfile --prod=false --filter @jc/jobs...
COPY jobs jobs
COPY packages/connectors packages/connectors
RUN useradd --system --uid 1001 app && chown -R app /repo
USER app
CMD ["pnpm", "--filter", "@jc/jobs", "start"]
