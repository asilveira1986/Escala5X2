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
# Atualização incremental do convite de colaborador (para bancos que já têm as migrations 0001 a 0008).
INC9=$DB/setup/supabase_atualizar_convite.sql
{
  echo "-- JornadaCerta: convite do colaborador (migration 0009) em um banco que já tem as migrations 0001 a 0008."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0009_convite_colaborador.up.sql"
  cat <<'SQL'

-- conferência: deve listar a tabela nova
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'convite_colaborador';
commit;
SQL
} > "$INC9"
echo "gerado: $INC9"
# Atualização incremental da cobertura (migration 0010) para bancos que já têm as migrations 0001 a 0009.
INC10=$DB/setup/supabase_atualizar_cobertura.sql
{
  echo "-- JornadaCerta: validação da demanda de cobertura (migration 0010) em um banco que já tem as migrations 0001 a 0009."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0010_demanda_setor.up.sql"
  echo "commit;"
} > "$INC10"
echo "gerado: $INC10"
# Atualização incremental do painel da carteira (migration 0011) para bancos que já têm as migrations 0001 a 0010.
INC11=$DB/setup/supabase_atualizar_carteira.sql
{
  echo "-- JornadaCerta: painel da carteira (migration 0011) em um banco que já tem as migrations 0001 a 0010."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0011_painel_carteira.up.sql"
  echo "commit;"
} > "$INC11"
echo "gerado: $INC11"
# Atualização incremental da geração automática de escalas (migration 0012) para bancos com as migrations 0001 a 0011.
INC12=$DB/setup/supabase_atualizar_otimizacao.sql
{
  echo "-- JornadaCerta: geração automática de escalas (migration 0012) em um banco que já tem as migrations 0001 a 0011."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0012_otimizacao.up.sql"
  echo "commit;"
} > "$INC12"
echo "gerado: $INC12"
# Atualização incremental das solicitações (migration 0013) para bancos com as migrations 0001 a 0012.
INC13=$DB/setup/supabase_atualizar_solicitacoes.sql
{
  echo "-- JornadaCerta: solicitações e trocas (migration 0013) em um banco que já tem as migrations 0001 a 0012."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0013_solicitacoes.up.sql"
  echo "commit;"
} > "$INC13"
echo "gerado: $INC13"
# Atualização incremental do banco de horas (migration 0014) para bancos com as migrations 0001 a 0013.
INC14=$DB/setup/supabase_atualizar_banco_horas.sql
{
  echo "-- JornadaCerta: banco de horas (migration 0014) em um banco que já tem as migrations 0001 a 0013."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0014_banco_horas.up.sql"
  echo "commit;"
} > "$INC14"
echo "gerado: $INC14"
# Atualização incremental do fechamento para a folha (migration 0015) para bancos com as migrations 0001 a 0014.
INC15=$DB/setup/supabase_atualizar_folha.sql
{
  echo "-- JornadaCerta: fechamento mensal para a folha (migration 0015) em um banco que já tem as migrations 0001 a 0014."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0015_fechamento_folha.up.sql"
  echo "commit;"
} > "$INC15"
echo "gerado: $INC15"
# Atualização incremental da importação do ponto/AFD (migration 0016) para bancos com as migrations 0001 a 0015.
INC16=$DB/setup/supabase_atualizar_ponto.sql
{
  echo "-- JornadaCerta: importação do ponto (AFD, migration 0016) em um banco que já tem as migrations 0001 a 0015."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0016_ponto_afd.up.sql"
  echo "commit;"
} > "$INC16"
echo "gerado: $INC16"
# Cadastro manual de colaborador (migration 0017) para bancos com as migrations 0001 a 0016.
INC17=$DB/setup/supabase_atualizar_colaborador.sql
{
  echo "-- JornadaCerta: cadastro manual de colaborador (migration 0017) em um banco que já tem as migrations 0001 a 0016."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0017_cadastro_colaborador.up.sql"
  echo "commit;"
} > "$INC17"
echo "gerado: $INC17"
# Edição e desligamento de colaborador (migration 0018) para bancos com as migrations 0001 a 0017.
INC18=$DB/setup/supabase_atualizar_edicao_colaborador.sql
{
  echo "-- JornadaCerta: edição, mudança de contrato e desligamento de colaborador (migration 0018) em um banco que já tem as migrations 0001 a 0017."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0018_editar_desligar_colaborador.up.sql"
  echo "commit;"
} > "$INC18"
echo "gerado: $INC18"
# Banco de horas alimentado pelo ponto (migration 0019) para bancos com as migrations 0001 a 0018.
INC19=$DB/setup/supabase_atualizar_banco_horas_ponto.sql
{
  echo "-- JornadaCerta: banco de horas pelo ponto (migration 0019) em um banco que já tem as migrations 0001 a 0018."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0019_banco_horas_ponto.up.sql"
  echo "commit;"
} > "$INC19"
echo "gerado: $INC19"
# Notificações dentro do sistema (migration 0020) para bancos com as migrations 0001 a 0019.
INC20=$DB/setup/supabase_atualizar_notificacoes.sql
{
  echo "-- JornadaCerta: notificações dentro do sistema (migration 0020) em um banco que já tem as migrations 0001 a 0019."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0020_notificacoes.up.sql"
  echo "commit;"
} > "$INC20"
echo "gerado: $INC20"
# Aviso de vencimento do banco de horas (migration 0021) para bancos com as migrations 0001 a 0020.
INC21=$DB/setup/supabase_atualizar_aviso_banco.sql
{
  echo "-- JornadaCerta: aviso de vencimento do banco de horas (migration 0021) em um banco que já tem as migrations 0001 a 0020."
  echo "-- Rode UMA vez. Transação única: se falhar, nada é aplicado."
  echo "begin;"
  cat "$DB/migrations/0021_aviso_vencimento_banco.up.sql"
  echo "commit;"
} > "$INC21"
echo "gerado: $INC21"
echo "gerado: $OUT ($(wc -l < "$OUT") linhas) e $UNDO"
