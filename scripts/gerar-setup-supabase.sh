#!/usr/bin/env bash
# Gera os arquivos para colar no SQL Editor do Supabase (um único script, numa transação).
# Uso: scripts/gerar-setup-supabase.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=packages/db
OUT=$DB/setup/supabase_instalar_tudo.sql
UNDO=$DB/setup/supabase_recomecar_do_zero.sql
MIGS=$(ls $DB/migrations/*.up.sql | sort)

{
  echo "-- JornadaCerta: instala o banco inteiro (migrations + regras legais + feriados)."
  echo "-- Gerado por scripts/gerar-setup-supabase.sh. Rode UMA vez, num projeto Supabase vazio."
  echo "-- Tudo roda numa transação: se qualquer parte falhar, nada é aplicado e você pode corrigir e rodar de novo."
  echo "begin;"
  for f in $MIGS; do echo; echo "-- ===== $(basename "$f") ====="; cat "$f"; done
  for f in regras feriados; do echo; echo "-- ===== seeds/$f.sql ====="; cat "$DB/seeds/$f.sql"; done
  cat <<'SQL'

-- ===== conferência =====
select 'regras legais' as item, count(*)::text as valor from public.regra_jornada
union all select 'feriados', count(*)::text from public.feriado
union all select 'tabelas com RLS ligado', count(*)::text from pg_tables where schemaname = 'public' and rowsecurity
union all select 'tabelas sem RLS (deve ser 0)', count(*)::text from pg_tables where schemaname = 'public' and not rowsecurity
union all select 'buckets de storage', coalesce((select count(*)::text from storage.buckets where id in ('importacoes', 'marca')), '0');
commit;
SQL
} > "$OUT"

cat > "$UNDO" <<'SQL'
-- JornadaCerta: RECOMEÇAR DO ZERO. Apaga TUDO que estiver no schema "public" (tabelas, funções, tipos, dados)
-- e o recria vazio, com as permissões padrão do Supabase. Funciona em qualquer estado: vazio, parcial ou completo.
-- Não mexe nos usuários (Authentication), nos segredos do Vault nem nos arquivos do Storage.
-- USE SÓ EM PROJETO DE TESTE, SEM DADOS REAIS.
begin;
drop schema if exists public cascade;
create schema public;
comment on schema public is 'standard public schema';
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
commit;
SQL
# Atualização incremental do interruptor de MFA (para bancos que já têm as migrations 0001 a 0004).
INC=$DB/setup/supabase_atualizar_interruptor_mfa.sql
{
  echo "-- JornadaCerta: adiciona o interruptor da verificação em duas etapas a um banco já instalado (migrations 0001 a 0004)."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0005_interruptor_mfa.up.sql"
  cat <<'SQL'

-- conferência: deve mostrar mfa_obrigatorio = true (ligado, o padrão seguro)
select chave, valor as ligado, motivo from public.configuracao_sistema where chave = 'mfa_obrigatorio';
commit;
SQL
} > "$INC"
echo "gerado: $INC"
# Atualização incremental das escalas (Fase 2) para bancos que já têm as migrations 0001 a 0005.
INC6=$DB/setup/supabase_atualizar_escalas.sql
{
  echo "-- JornadaCerta: adiciona as tabelas de escalas (Fase 2) a um banco já instalado (migrations 0001 a 0005)."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0006_escalas.up.sql"
  cat "$DB/migrations/0007_escala_entrada.up.sql"
  cat "$DB/migrations/0008_salvar_alocacoes.up.sql"
  cat <<'SQL'

-- conferência: deve listar as 7 tabelas novas
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('turno_modelo','demanda_cobertura','ausencia','escala','alocacao','violacao','ciencia')
 order by 1;
commit;
SQL
} > "$INC6"
echo "gerado: $INC6"
echo "gerado: $OUT ($(wc -l < "$OUT") linhas) e $UNDO"
