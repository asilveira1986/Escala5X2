# Fase 1 — MVP de diagnóstico

## Entregue
- **Regras legais como dados** (`regra_jornada`, seeds idempotentes, editáveis só por superadmin com MFA, auditadas). Convenção: prioridade 100 = geral, 200 = escopo (porte/terceirizada), 300 = exceção individual; maior prioridade vence na mescla. Um teste garante que a seed SQL e o fixture do motor não divergem.
- **Motor `@jc/rules-engine`** (TS puro): `resolverRegras`, `diagnosticar`, `simular`. 69 testes, 100% linhas / 89,5% ramos. Datas são strings `aaaa-mm-dd` (sem fuso); dinheiro em centavos inteiros.
- **Cadastros**: sindicato, unidade, setor, colaborador, contrato_versao (sem sobreposição), acordos e cláusulas, com RLS e auditoria. `organizacao_id` é herdada da empresa por gatilho (não dá para forjar).
- **PII**: CPF e telefone cifrados (pgcrypto, chave no Vault ou `app.chave_dados`); busca por HMAC; revelar exige permissão e é auditado.
- **View `vw_colaborador_vigente`** (alta renda sem placeholder).
- **Importação CSV/XLSX**: leitura (BOM, `;`, Windows-1252), assistente de mapeamento, validação linha a linha, relatório e CSV de erros; worker pg-boss; idempotente; modo parcial.
- **Diagnóstico e cenários** via RPC com RLS do usuário; resultado, itens e snapshot das regras usadas ficam salvos.
- **Relatórios PDF e XLSX** com marca do escritório; exportar é auditado.
- **Telas** (pt-BR, responsivas): empresas, colaboradores, importação, diagnóstico, simulador e comparação de cenários.

## Correções de segurança encontradas durante a fase
1. Colaborador e líder enxergavam a empresa inteira (e salários) via `minhas_organizacoes()`. Agora só papéis de gestão.
2. `importacao.arquivo_path` forjável: o worker (service_role) poderia ler arquivo de outra organização. Gatilho valida a pasta; o worker revalida.
3. `criado_por` forjável (auditoria): sempre `auth.uid()`.
4. Convenção cadastrada pelo escritório jurídico precisa ser visível ao RH do cliente e aplicada ao diagnóstico; senão a exceção sumiria em silêncio. Vínculo exige `vinculo_empresa` de nível `juridico`.

## Decisões e desvios do prompt original
- **SheetJS → exceljs + papaparse**: o CDN do SheetJS estava bloqueado neste ambiente e o `xlsx` do npm tem CVEs conhecidos para arquivos enviados por usuários.
- **Drizzle**: não adotado nesta fase; o SQL das migrations é a fonte da verdade e o acesso é por RPC/SQL. Gerar tipos (`supabase gen types`) é um próximo passo.
- **`validarEscala` e `calcularHoras`** ficam para a Fase 2 (editor de escalas).
- **Distribuição do déficit por dia da semana** é estimada de forma uniforme (não há dias na planilha).
- **Terceirizada pública**: o prazo (16/10/2027) vira o "prazo de adequação" da fase 1.
- **F2 sem data final**: avalia-se o estado no início; vencimento posterior de acordo vira alerta.
- Telas usam Tailwind + componentes próprios (sem a CLI do shadcn).

## Não testado / pendências
1. **Fluxo real no Supabase** (login, Storage, RPC via PostgREST, Server Actions): só build, tipos, componentes e RPC simulada em Postgres local. É o principal risco.
2. **pg-boss no Supabase**: exige conexão direta ou "session mode" (não a porta 6543). Worker precisa ser hospedado (Railway/Fly) com `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; o app web precisa de `DATABASE_URL` para enfileirar.
3. Migration `0003_storage` só foi exercitada contra um mínimo do schema `storage`.
4. Chave de criptografia: criar o segredo `chave_dados` no Vault de cada ambiente antes de importar.
5. Layouts de planilhas reais de clientes (Domínio, Alterdata…) não foram vistos; o mapeamento por apelidos cobre os nomes comuns.
6. Playwright E2E fica para a Fase 2.
7. Horas extras: o simulador não checa o limite de 2h/dia (apenas alerta).
