-- JornadaCerta: mostra o que já está instalado neste projeto Supabase (só leitura).
select
  (select count(*) from information_schema.tables where table_schema = 'public') as tabelas_no_public,
  to_regclass('public.organizacao') is not null as tem_0001_organizacao,
  to_regclass('public.regra_jornada') is not null as tem_0002_regras,
  exists (select 1 from pg_trigger where tgname = 'ao_cadastrar_usuario') as tem_0004_gatilho,
  (select count(*) from storage.buckets where id in ('importacoes', 'marca')) as buckets;
