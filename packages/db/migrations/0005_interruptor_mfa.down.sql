-- restaura mfa_ok da migration 0001 (MFA sempre exigido para papéis sensíveis)
create or replace function mfa_ok(p papel) returns boolean
language sql stable as $$
  select not papel_exige_mfa(p) or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
drop function if exists definir_mfa_obrigatorio(boolean, text);
drop function if exists mfa_obrigatorio();
drop table if exists configuracao_sistema;
