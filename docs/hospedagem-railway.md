# Hospedagem no Railway (app + worker)

Dois serviços no mesmo projeto Railway, a partir do mesmo repositório:

| Serviço | O que faz | Arquivo de configuração | Domínio público |
|---|---|---|---|
| `web` | Painel (Next.js) | `railway.web.json` → `apps/web/Dockerfile` | sim |
| `worker` | Processa as importações de planilha (pg-boss) | `railway.worker.json` → `jobs/Dockerfile` | não |

Pré-requisito: o banco do Supabase instalado (`docs/instalacao-do-zero.md`, passos 1 a 3).

## 1. Criar o projeto
1. Acesse **railway.com** e entre com o GitHub.
2. **New Project → Deploy from GitHub repo** → escolha `asilveira1986/Escala5X2`. Se pedir, autorize o app do Railway a ler o repositório.
3. O Railway cria um serviço e tenta o primeiro build. Pode falhar, é esperado: falta configurar.

## 2. Serviço `web`
Clique no serviço → **Settings**:
- **Service Name:** `web`.
- **Source → Branch:** `main` (se o PR ainda não foi mesclado, use `fix/compat-supabase`).
- **Root Directory:** deixe **vazio** (o build precisa da raiz do repositório).
- **Config-as-code → Railway Config File:** `/railway.web.json`.
- **Deploy → Region:** a mais próxima do Brasil (costuma ser *US East*).
- **Networking → Generate Domain:** copie o endereço, algo como `https://web-production-xxxx.up.railway.app`.

**Variables** (aba ao lado de Settings), adicione:

| Nome | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL do Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave *publishable* |
| `NEXT_PUBLIC_APP_URL` | o domínio gerado acima, com `https://` |
| `DATABASE_URL` | *Session pooler* (porta 5432), com a senha |

Nunca coloque a chave *secret* neste serviço. Cada mudança nas variáveis `NEXT_PUBLIC_*` refaz o build (elas entram no código na hora do build).

## 3. Serviço `worker`
No canvas do projeto: **+ New → GitHub Repo** → o mesmo repositório. Em **Settings**:
- **Service Name:** `worker`; **Root Directory:** vazio; **Branch:** a mesma do `web`.
- **Config-as-code → Railway Config File:** `/railway.worker.json`.
- **Deploy → Region:** a mesma do `web`. Não gere domínio.

**Variables:** `DATABASE_URL` (mesmo valor), `SUPABASE_URL` (Project URL) e `SUPABASE_SERVICE_ROLE_KEY` (chave *secret*). Esta chave dá acesso total: ela fica **só** no worker.

## 4. Conferir
- `web` → **Deployments → View logs**: deve aparecer `Ready`. Abra `https://SEU-DOMINIO/api/health`: responde `{"ok":true,"servico":"web"}`.
- `worker` → logs: `Worker de jobs em execução.`
- Abra `https://SEU-DOMINIO/login`.

## 5. Ajustar o Supabase
*Authentication → URL Configuration:* **Site URL** = o domínio do Railway; **Redirect URLs** = `https://SEU-DOMINIO/auth/callback`.

## Se algo falhar
| Sintoma | Causa provável |
|---|---|
| Build falha em "pnpm install" | Root Directory preenchido: deixe vazio |
| Build falha mencionando `NEXT_PUBLIC_...` | Variáveis do `web` ausentes ao construir; adicione e refaça o deploy |
| Healthcheck falha | O serviço não subiu: veja os logs. `/api/health` precisa responder em 60 s |
| Login redireciona em loop | `NEXT_PUBLIC_*` erradas; corrija e espere o novo build |
| Importação fica em "processando" | O `worker` não está rodando ou falta alguma das 3 variáveis |
| `worker` reinicia sem parar | `DATABASE_URL` incorreta (senha com caractere especial sem codificar) |

## Custos e região
O Railway cobra por uso (confirme os planos no site). As regiões dele ficam nos EUA/Europa/Ásia; o banco continua em São Paulo (Supabase). Para ter tudo no Brasil, a alternativa é Fly.io em São Paulo ou uma VPS: os mesmos Dockerfiles servem.
