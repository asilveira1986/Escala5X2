#!/usr/bin/env bash
# Gera os arquivos para colar no SQL Editor do Supabase (um único script, numa transação).
# Uso: scripts/gerar-setup-supabase.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=packages/db
OUT=$DB/setup/supabase_instalar_tudo.sql
UNDO=$DB/setup/supabase_desfazer_tudo.sql
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

{
  echo "-- JornadaCerta: desfaz a instalação (apaga as tabelas do app). Use só em projeto de testes."
  echo "begin;"
  for f in $(ls $DB/migrations/*.down.sql | sort -r); do echo; echo "-- ===== $(basename "$f") ====="; cat "$f"; done
  echo "commit;"
} > "$UNDO"
echo "gerado: $OUT ($(wc -l < "$OUT") linhas) e $UNDO"
