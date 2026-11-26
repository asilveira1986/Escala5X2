-- JornadaCerta: retira a verificação em duas etapas (migration 0025) de um banco que já tem as migrations 0001 a 0024.
-- Rode UMA vez. Transação única: se falhar, nada é aplicado.
begin;
-- Fim da verificação em duas etapas (MFA).
--
-- Decisão de produto: o sistema deixa de exigir MFA de qualquer papel. As políticas de acesso (RLS) chamam mfa_ok(papel);
-- ela passa a liberar sempre, e as políticas continuam iguais (o acesso segue limitado por papel, organização e empresa).
-- O interruptor temporário (migration 0005) deixa de existir: tabela e funções de liga/desliga saem junto.
create or replace function mfa_ok(p papel) returns boolean
language sql stable as $$ select true $$;

drop function if exists definir_mfa_obrigatorio(boolean, text);
drop function if exists mfa_obrigatorio();
drop table if exists configuracao_sistema;
commit;
