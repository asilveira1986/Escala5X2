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
