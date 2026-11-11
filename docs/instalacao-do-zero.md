# Instalação do zero (passos manuais)

O container do Claude **não consegue falar direto com o Postgres** (só HTTPS), então o banco é instalado por você, uma vez, colando um SQL no painel do Supabase. O resto eu consigo conferir daqui.

## 1. Supabase
1. Crie o projeto em **South America (São Paulo)**. Região não muda depois. Nome sugerido: `jornadacerta-dev`. Guarde a senha do banco.
2. **SQL Editor → New query:** cole todo o conteúdo de `packages/db/setup/supabase_instalar_tudo.sql` e clique em **Run**.
   Resultado esperado, na última tabela: regras legais 8, feriados 30, tabelas com RLS 21, sem RLS 0, buckets 2.
   Se der erro, nada foi aplicado (é uma transação): copie a mensagem inteira. Para recomeçar um projeto de teste: rode antes `supabase_desfazer_tudo.sql`.
3. **Chave de criptografia (Vault).** Em *Integrations → Vault*, ative se pedir. No SQL Editor:
   ```sql
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'chave_dados', 'Cifragem de CPF e telefone');
   select decrypted_secret from vault.decrypted_secrets where name = 'chave_dados';
   ```
   Copie o valor do segundo comando **para um gerenciador de senhas**. Se for perdido, os CPFs ficam irrecuperáveis. Não cole no chat.
4. **Authentication:** *Sign In / Providers → Email* ligado (senha mínima 8; "Confirm email" pode ficar desligado em desenvolvimento). *Multi-Factor* com **TOTP** habilitado. *URL Configuration:* Site URL = URL do app; Redirect URLs = `https://SEU-APP.vercel.app/auth/callback` e `http://localhost:3000/auth/callback`.
5. **Primeiro usuário:** *Authentication → Users → Add user → Create new user* (marque *Auto Confirm User*). Ao entrar no app, ele cria a organização e cadastra o autenticador.
6. **Chaves:** *Settings → API Keys* (publishable e secret) e *Integrations → Data API* (Project URL). *Connect → Session pooler* (porta 5432) para a `DATABASE_URL`.

## 2. Vercel (projeto do app)
- *Settings → General → Root Directory* = `apps/web`. *Settings → Git → Production Branch* = `main`.
- *Settings → Environment Variables* (Production e Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable), `NEXT_PUBLIC_APP_URL` (URL do app), `DATABASE_URL` (Session pooler). **Nunca** a secret key.
- Depois de mudar variável: **Deployments → ⋯ → Redeploy** (as `NEXT_PUBLIC_*` entram na hora do build).

## 3. Ambiente do Claude (barra de título → ambiente → Edit)
Cinco variáveis: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret key), `DATABASE_URL`. Rede: `*.supabase.co` e `*.pooler.supabase.com`. Abra uma **sessão nova** para valer.

## 4. Worker de importação (ainda por fazer)
A importação de planilhas é processada por um worker sempre ligado (Railway ou Fly, região de São Paulo) com `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Sem ele, o upload funciona mas a importação fica em "processando". O Dockerfile do worker ainda não existe no repositório.

## Se algo falhar
| Sintoma | Causa provável |
|---|---|
| Tela de login sem estilo | A Vercel publica uma branch antiga: *Production Branch* = `main` e Redeploy |
| `relation ... does not exist` | O SQL do passo 1.2 não foi aplicado |
| "Invalid login credentials" | Usuário não criado, sem *Auto Confirm*, ou senha errada |
| Volta sempre ao login | Variáveis `NEXT_PUBLIC_*` ausentes ou antigas na Vercel (falta Redeploy) |
| Erro ao abrir link do e-mail | *Redirect URLs* sem `/auth/callback` |
| Erro ao cadastrar autenticador | MFA/TOTP desligado no Supabase |
