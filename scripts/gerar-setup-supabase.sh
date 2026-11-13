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
echo "gerado: $OUT ($(wc -l < "$OUT") linhas) e $UNDO"
