# Instalação do zero (passos manuais)

O container do Claude **não consegue falar direto com o Postgres** (só HTTPS), então o banco é instalado por você, uma vez, colando um SQL no painel do Supabase. O resto eu consigo conferir daqui.

## 1. Supabase
1. Crie o projeto em **South America (São Paulo)**. Região não muda depois. Nome sugerido: `jornadacerta-dev`. Guarde a senha do banco.
2. **SQL Editor → New query:** cole todo o conteúdo de `packages/db/setup/supabase_instalar_tudo.sql` e clique em **Run**.
   Resultado esperado, na última tabela: regras legais 8, feriados 30, tabelas com RLS 21, sem RLS 0, buckets 2.
   Se der erro, nada foi aplicado (é uma transação): copie a mensagem inteira.
   Erro `type "tipo_org" already exists`: o banco já tem algo instalado. Rode `packages/db/setup/supabase_diagnostico.sql` para ver o que existe. Se for um projeto de teste sem dados, rode `supabase_recomecar_do_zero.sql` (apaga tudo do schema `public`, funciona em qualquer estado) e depois o instalador de novo.
3. **Chave de criptografia (Vault).** Em *Integrations → Vault*, ative se pedir. No SQL Editor:
   ```sql
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'chave_dados', 'Cifragem de CPF e telefone');
   select decrypted_secret from vault.decrypted_secrets where name = 'chave_dados';
   ```
   Copie o valor do segundo comando **para um gerenciador de senhas**. Se for perdido, os CPFs ficam irrecuperáveis. Não cole no chat.
4. **Authentication:** *Sign In / Providers → Email* ligado (senha mínima 8; "Confirm email" pode ficar desligado em desenvolvimento). *Multi-Factor* com **TOTP** habilitado. *URL Configuration:* Site URL = URL do app; Redirect URLs = `https://SEU-DOMINIO-RAILWAY/auth/callback` e `http://localhost:3000/auth/callback`.
5. **Primeiro usuário:** *Authentication → Users → Add user → Create new user* (marque *Auto Confirm User*). Ao entrar no app, ele cria a organização.
6. **Chaves:** *Settings → API Keys* (publishable e secret) e *Integrations → Data API* (Project URL). *Connect → Session pooler* (porta 5432) para a `DATABASE_URL`.

## 2. Hospedagem (Railway)
Veja `docs/hospedagem-railway.md`: dois serviços (`web` e `worker`) a partir deste repositório, com as variáveis e o domínio.

## 3. Ambiente do Claude (barra de título → ambiente → Edit)
Cinco variáveis: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret key), `DATABASE_URL`. Rede: `*.supabase.co` e `*.pooler.supabase.com`. Abra uma **sessão nova** para valer.

## Se algo falhar
| Sintoma | Causa provável |
|---|---|
| Tela de login sem estilo | O serviço está publicando uma branch antiga: confira a *Branch* no Railway |
| `relation ... does not exist` | O SQL do passo 1.2 não foi aplicado |
| "Invalid login credentials" | Usuário não criado, sem *Auto Confirm*, ou senha errada |
| Volta sempre ao login | Variáveis `NEXT_PUBLIC_*` ausentes ou antigas no Railway (cada mudança refaz o build) |
| Erro ao abrir link do e-mail | *Redirect URLs* sem `/auth/callback` |
